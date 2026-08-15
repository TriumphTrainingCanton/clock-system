import bcrypt from "bcryptjs";
import { Client, neon, neonConfig } from "@neondatabase/serverless";
import {
  ActionPayload,
  formatError,
  isReadAction,
  normalizeStatus,
  numberAtLeastZero,
  parseCookies,
  requiredString,
  validIsoDate,
  validPin,
  validRequestId,
  validTime
} from "./lib";

interface Env {
  ASSETS: Fetcher;
  NEON_DATABASE_URL?: string;
  ADMIN_SESSION_SECRET?: string;
  APPS_SCRIPT_URL?: string;
  SHEETS_SYNC_KEY?: string;
  APP_ENV: string;
  APP_TIME_ZONE: string;
}

type DbResult = { rows: any[]; rowCount: number | null };
type DbClient = { query(text: string, values?: unknown[]): Promise<DbResult> };
type AdminResult = { body: string; headers?: HeadersInit };

const ADMIN_COOKIE = "triumph_admin";
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
const JSON_LIMIT_BYTES = 16_384;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SHEET_SYNC_TIMEOUT_MS = 40_000;

neonConfig.webSocketConstructor = WebSocket;

const SHEET_SYNC_ACTIONS = new Set([
  "Clock In",
  "Clock Out",
  "Submit Missed Punch",
  "Add Employee",
  "Update Employee",
  "Deactivate Employee",
  "Reactivate Employee",
  "Delete Employee"
]);

function textResponse(body: string, status = 200, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers
    }
  });
}

function jsonText(value: unknown): string {
  return JSON.stringify(value);
}

function clientIp(request: Request): string | null {
  return request.headers.get("CF-Connecting-IP") || null;
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new Error("Cross-site requests are not allowed.");
  }
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new Error("Cross-site requests are not allowed.");
  }
}

async function readPayload(request: Request): Promise<ActionPayload> {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > JSON_LIMIT_BYTES) throw new Error("Request is too large.");

  const body = await request.text();
  if (encoder.encode(body).byteLength > JSON_LIMIT_BYTES) throw new Error("Request is too large.");

  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as ActionPayload;
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function base64Url(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer as ArrayBuffer;
}

async function sessionEncryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function sheetEncryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptSheetPayload(secret: string, payload: ActionPayload): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await sheetEncryptionKey(secret),
    encoder.encode(JSON.stringify(payload))
  );
  return `${base64Url(iv.buffer as ArrayBuffer)}.${base64Url(ciphertext)}`;
}

async function decryptSheetPayload(secret: string, encrypted: string): Promise<ActionPayload> {
  const parts = encrypted.split(".");
  if (parts.length !== 2) throw new Error("Invalid encrypted Sheet payload.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(fromBase64Url(parts[0])) },
    await sheetEncryptionKey(secret),
    fromBase64Url(parts[1])
  );
  return JSON.parse(decoder.decode(plaintext)) as ActionPayload;
}

function requireSheetSync(env: Env, action: string): void {
  if (!SHEET_SYNC_ACTIONS.has(action)) return;
  if (!env.APPS_SCRIPT_URL || !env.SHEETS_SYNC_KEY) {
    throw new Error("The Google Sheets backup queue is not configured.");
  }
}

function sheetSyncKey(action: string, payload: ActionPayload): string {
  const requestId = validRequestId(payload.requestId) ? String(payload.requestId) : crypto.randomUUID();
  return `${action}:${requestId}`;
}

async function queueSheetSync(client: DbClient, env: Env, action: string, payload: ActionPayload): Promise<void> {
  requireSheetSync(env, action);
  if (!SHEET_SYNC_ACTIONS.has(action)) return;

  const sheetPayload: ActionPayload = { ...payload, action };
  if (!action.startsWith("Clock ") && action !== "Submit Missed Punch" && !validPin(sheetPayload.adminPin)) {
    throw new Error("The Google Sheets admin sync is not authenticated.");
  }
  const encrypted = await encryptSheetPayload(String(env.SHEETS_SYNC_KEY), sheetPayload);
  await client.query(
    `INSERT INTO sheet_sync_outbox (sync_key, action, encrypted_payload)
     VALUES ($1, $2, $3)
     ON CONFLICT (sync_key) DO NOTHING`,
    [sheetSyncKey(action, payload), action, encrypted]
  );
}

type SheetSyncRow = { id: string; encrypted_payload: string };

async function claimSheetSyncRow(client: DbClient): Promise<SheetSyncRow | null> {
  const result = await client.query(`
    WITH candidate AS (
      SELECT id
      FROM sheet_sync_outbox
      WHERE (status='pending' AND next_attempt_at <= now())
         OR (status='processing' AND locked_at < now() - interval '5 minutes')
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE sheet_sync_outbox o
    SET status='processing', locked_at=now(), attempts=attempts+1, updated_at=now()
    FROM candidate
    WHERE o.id=candidate.id
    RETURNING o.id, o.encrypted_payload
  `);
  return (result.rows[0] as SheetSyncRow | undefined) ?? null;
}

async function markSheetSyncComplete(client: DbClient, id: string): Promise<void> {
  await client.query(
    `UPDATE sheet_sync_outbox
     SET status='synced', synced_at=now(), locked_at=NULL, last_error=NULL, updated_at=now()
     WHERE id=$1`,
    [id]
  );
}

async function markSheetSyncRetry(client: DbClient, id: string, message: string): Promise<void> {
  await client.query(
    `UPDATE sheet_sync_outbox
     SET status='pending', locked_at=NULL,
         next_attempt_at=now() + (LEAST(30, GREATEST(1, attempts * attempts)) * interval '1 minute'),
         last_error=$2, updated_at=now()
     WHERE id=$1`,
    [id, message.slice(0, 240)]
  );
}

async function callSheets(env: Env, payload: ActionPayload): Promise<string> {
  if (!env.APPS_SCRIPT_URL) throw new Error("Google Sheets endpoint is unavailable.");
  const response = await fetch(env.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    redirect: "follow",
    signal: AbortSignal.timeout(SHEET_SYNC_TIMEOUT_MS)
  });
  const responseText = (await response.text()).trim();
  if (!response.ok || responseText.startsWith("<")) {
    throw new Error(`Google Sheets delivery failed with status ${response.status}.`);
  }
  return responseText;
}

async function sendSheetPayload(env: Env, payload: ActionPayload): Promise<void> {
  const responseText = await callSheets(env, payload);
  if (!responseText.startsWith("Success")) {
    const employeeName = typeof payload.name === "string" ? payload.name.trim() : "";
    const safeResponse = responseText
      .replace(/\b\d{4}\b/g, "[redacted]")
      .replace(employeeName, employeeName ? "[employee]" : "")
      .replace(/\s+/g, " ")
      .slice(0, 160);
    throw new Error(`Google Sheets rejected the delivery: ${safeResponse || "empty response"}`);
  }
}

async function flushSheetOutbox(env: Env): Promise<void> {
  if (!env.NEON_DATABASE_URL || !env.SHEETS_SYNC_KEY || !env.APPS_SCRIPT_URL) return;
  const client = new Client({ connectionString: env.NEON_DATABASE_URL });
  await client.connect();
  let row: SheetSyncRow | null = null;
  try {
    row = await claimSheetSyncRow(client);
    if (!row) return;
    const payload = await decryptSheetPayload(env.SHEETS_SYNC_KEY, row.encrypted_payload);
    await sendSheetPayload(env, payload);
    await markSheetSyncComplete(client, row.id);
  } catch (error) {
    if (row) {
      const message = error instanceof Error ? error.message : "Google Sheets delivery failed.";
      await markSheetSyncRetry(client, row.id, message).catch(() => undefined);
    }
    console.error("Google Sheets background delivery failed.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function createAdminSession(secret: string, adminPin: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await sessionEncryptionKey(secret),
    encoder.encode(`${expires}.${adminPin}`)
  );
  return `v2.${base64Url(iv.buffer as ArrayBuffer)}.${base64Url(ciphertext)}`;
}

async function adminPinFromSession(request: Request, secret: string): Promise<string | null> {
  const token = parseCookies(request.headers.get("Cookie"))[ADMIN_COOKIE];
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v2") return null;

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(fromBase64Url(parts[1])) },
      await sessionEncryptionKey(secret),
      fromBase64Url(parts[2])
    );
    const [expiresText, adminPin] = decoder.decode(plaintext).split(".", 2);
    const expires = Number(expiresText);
    if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000) || !validPin(adminPin)) return null;
    return adminPin;
  } catch {
    return null;
  }
}

async function assertAdmin(request: Request, env: Env): Promise<string> {
  const adminPin = env.ADMIN_SESSION_SECRET
    ? await adminPinFromSession(request, env.ADMIN_SESSION_SECRET)
    : null;
  if (!adminPin) {
    throw new Error("Admin session expired. Sign in again.");
  }
  return adminPin;
}

async function verifyAdmin(payload: ActionPayload, env: Env): Promise<AdminResult> {
  if (!env.ADMIN_SESSION_SECRET) throw new Error("Admin authentication is not configured.");
  if (!validPin(payload.adminPin)) throw new Error("Incorrect Admin PIN.");

  // The legacy Apps Script does not expose a standalone "Verify Admin" action.
  // Reuse its authenticated dashboard read once at login, then rely on the
  // encrypted Worker session for subsequent fast Neon-backed admin requests.
  const verification = await callSheets(env, { action: "Get Admin Dashboard", adminPin: payload.adminPin });
  try {
    const dashboard = JSON.parse(verification);
    if (!dashboard || typeof dashboard !== "object" || Array.isArray(dashboard)) throw new Error();
  } catch {
    throw new Error("Incorrect Admin PIN.");
  }

  const token = await createAdminSession(env.ADMIN_SESSION_SECRET, String(payload.adminPin));
  return {
    body: "Success: Admin Dashboard Unlocked.",
    headers: {
      "set-cookie": `${ADMIN_COOKIE}=${token}; Max-Age=${ADMIN_SESSION_SECONDS}; Path=/api; HttpOnly; Secure; SameSite=Strict`
    }
  };
}

async function employeeForPin(client: DbClient, nameValue: unknown, pinValue: unknown) {
  const name = requiredString(nameValue, "Employee name", 120);
  if (!validPin(pinValue)) throw new Error("Incorrect employee name or PIN.");

  const result = await client.query(
    "SELECT id, name::text AS name, pin_hash, hourly_rate, active FROM employees WHERE name = $1 AND deleted_at IS NULL LIMIT 1",
    [name]
  );
  const employee = result.rows[0];
  if (!employee || !employee.active || !(await bcrypt.compare(String(pinValue), employee.pin_hash))) {
    throw new Error("Incorrect employee name or PIN.");
  }
  return employee;
}

async function inTransaction<T>(client: DbClient, operation: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await operation();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function getEmployees(client: DbClient): Promise<string> {
  const result = await client.query(
    "SELECT name::text AS name FROM employees WHERE active = true AND deleted_at IS NULL ORDER BY name"
  );
  return jsonText(result.rows);
}

async function clockIn(client: DbClient, payload: ActionPayload, request: Request, env: Env): Promise<string> {
  if (!validRequestId(payload.requestId)) throw new Error("A valid request ID is required.");
  const requestId = String(payload.requestId);

  return inTransaction(client, async () => {
    const replay = await client.query("SELECT 1 FROM shifts WHERE clock_in_request_id = $1", [requestId]);
    if (replay.rowCount) return "Success: This clock-in was already recorded.";

    const employee = await employeeForPin(client, payload.name, payload.pin);
    const open = await client.query(
      "SELECT 1 FROM shifts WHERE employee_id = $1 AND clock_out_at IS NULL FOR UPDATE",
      [employee.id]
    );
    if (open.rowCount) throw new Error(`${employee.name} is already clocked in.`);

    await client.query(
      `INSERT INTO shifts
        (employee_id, clock_in_at, clock_in_request_id, clock_in_ip, source, rate_at_shift)
       VALUES ($1, now(), $2, $3, 'clock_portal', $4)`,
      [employee.id, requestId, clientIp(request), employee.hourly_rate]
    );
    await queueSheetSync(client, env, "Clock In", payload);
    return `Success: ${employee.name} clocked in.`;
  });
}

async function clockOut(client: DbClient, payload: ActionPayload, request: Request, env: Env): Promise<string> {
  if (!validRequestId(payload.requestId)) throw new Error("A valid request ID is required.");
  const requestId = String(payload.requestId);

  return inTransaction(client, async () => {
    const replay = await client.query("SELECT 1 FROM shifts WHERE clock_out_request_id = $1", [requestId]);
    if (replay.rowCount) return "Success: This clock-out was already recorded.";

    const employee = await employeeForPin(client, payload.name, payload.pin);
    const open = await client.query(
      "SELECT id FROM shifts WHERE employee_id = $1 AND clock_out_at IS NULL FOR UPDATE",
      [employee.id]
    );
    if (!open.rowCount) throw new Error(`${employee.name} is not currently clocked in.`);

    await client.query(
      `UPDATE shifts
       SET clock_out_at = now(),
           clock_out_request_id = $2,
           clock_out_ip = $3,
           recorded_hours = round((extract(epoch FROM (now() - clock_in_at)) / 3600.0)::numeric, 4),
           recorded_projected_pay = round(((extract(epoch FROM (now() - clock_in_at)) / 3600.0) * COALESCE(rate_at_shift, $4))::numeric, 2),
           updated_at = now()
       WHERE id = $1`,
      [open.rows[0].id, requestId, clientIp(request), employee.hourly_rate]
    );
    await queueSheetSync(client, env, "Clock Out", payload);
    return `Success: ${employee.name} clocked out.`;
  });
}

async function submitMissedPunch(client: DbClient, payload: ActionPayload, env: Env): Promise<string> {
  if (!validRequestId(payload.requestId)) throw new Error("A valid request ID is required.");
  if (!validIsoDate(payload.requestedDate)) throw new Error("Choose a valid missed-punch date.");
  if (!validTime(payload.requestedTime)) throw new Error("Choose a valid missed-punch time.");
  const reason = requiredString(payload.reason, "Reason", 200);
  if (reason.length < 5) throw new Error("Reason must be at least 5 characters.");

  return inTransaction(client, async () => {
    const requestId = String(payload.requestId);
    const replay = await client.query("SELECT 1 FROM missed_punch_requests WHERE request_id = $1", [requestId]);
    if (replay.rowCount) return "Success: This missed-punch request was already submitted.";

    const employee = await employeeForPin(client, payload.name, payload.pin);
    await client.query(
      `INSERT INTO missed_punch_requests
        (employee_id, request_id, requested_date, requested_time, reason, request_type)
       VALUES ($1, $2, $3::date, $4::time, $5, 'Missed Clock Out')`,
      [employee.id, requestId, payload.requestedDate, payload.requestedTime, reason]
    );
    await queueSheetSync(client, env, "Submit Missed Punch", payload);
    return `Success: Missed clock-out request submitted for ${employee.name}.`;
  });
}

async function getAdminDashboard(client: DbClient): Promise<string> {
  const result = await client.query(`
    WITH
      visible_employees AS (
        SELECT id, name, hourly_rate, active FROM employees WHERE deleted_at IS NULL
      ),
      completed AS (
        SELECT * FROM payroll_completed_shifts
      )
    SELECT json_build_object(
      'analytics', json_build_object(
        'totalEmployees', (SELECT count(*) FROM visible_employees WHERE active),
        'activeCount', (SELECT count(*) FROM shifts s JOIN visible_employees e ON e.id=s.employee_id WHERE s.clock_out_at IS NULL),
        'completedShifts', (SELECT count(*) FROM completed),
        'pendingMissedRequests', (SELECT count(*) FROM missed_punch_requests WHERE status='pending'),
        'totalProjectedPay', COALESCE((SELECT round(sum(projected_pay), 2) FROM completed), 0)
      ),
      'clockedIn', COALESCE((
        SELECT json_agg(row_to_json(x) ORDER BY x.sort_at)
        FROM (
          SELECT e.name::text AS name,
                 to_char(s.clock_in_at AT TIME ZONE 'America/Detroit', 'MM/DD/YYYY') AS date,
                 to_char(s.clock_in_at AT TIME ZONE 'America/Detroit', 'FMHH12:MI AM') AS "clockIn",
                 s.clock_in_at AS sort_at
          FROM shifts s JOIN visible_employees e ON e.id=s.employee_id
          WHERE s.clock_out_at IS NULL
        ) x
      ), '[]'::json),
      'employees', COALESCE((
        SELECT json_agg(json_build_object('name', name::text, 'rate', hourly_rate, 'active', active) ORDER BY name)
        FROM visible_employees
      ), '[]'::json),
      'payrollSummary', COALESCE((
        SELECT json_agg(json_build_object('name', name::text, 'hours', hours, 'pay', pay) ORDER BY name)
        FROM (
          SELECT name, round(sum(hours), 2) AS hours, round(sum(projected_pay), 2) AS pay
          FROM completed GROUP BY name
        ) p
      ), '[]'::json),
      'missedPunchRequests', COALESCE((
        SELECT json_agg(row_to_json(m) ORDER BY m.sort_at DESC)
        FROM (
          SELECT r.admin_row_number AS "rowNumber", e.name::text AS name, r.request_type AS type,
                 to_char(r.requested_date, 'MM/DD/YYYY') AS "requestedDate",
                 to_char(r.requested_time, 'FMHH12:MI AM') AS "requestedTime",
                 initcap(r.status) AS status, r.created_at AS sort_at
          FROM missed_punch_requests r JOIN employees e ON e.id=r.employee_id
          WHERE r.status='pending' ORDER BY r.created_at DESC LIMIT 10
        ) m
      ), '[]'::json),
      'recentPunches', COALESCE((
        SELECT json_agg(row_to_json(p) ORDER BY p.sort_at DESC)
        FROM (
          SELECT e.name::text AS name,
                 to_char(s.clock_in_at AT TIME ZONE 'America/Detroit', 'MM/DD/YYYY') AS date,
                 to_char(s.clock_in_at AT TIME ZONE 'America/Detroit', 'FMHH12:MI AM') AS "clockIn",
                 CASE WHEN s.clock_out_at IS NULL THEN NULL ELSE to_char(s.clock_out_at AT TIME ZONE 'America/Detroit', 'FMHH12:MI AM') END AS "clockOut",
                 CASE WHEN s.clock_out_at IS NULL THEN 0 ELSE round(extract(epoch FROM (s.clock_out_at-s.clock_in_at))/3600.0, 2) END AS hours,
                 s.clock_in_at AS sort_at
          FROM shifts s JOIN employees e ON e.id=s.employee_id
          ORDER BY s.clock_in_at DESC LIMIT 10
        ) p
      ), '[]'::json)
    ) AS dashboard
  `);
  return jsonText(result.rows[0].dashboard);
}

async function addEmployee(client: DbClient, payload: ActionPayload, env: Env): Promise<string> {
  const name = requiredString(payload.employeeName, "Employee name", 120);
  const rate = numberAtLeastZero(payload.hourlyRate, "Hourly rate");
  if (!validPin(payload.employeePin)) throw new Error("PIN must be exactly 4 digits.");
  const pinHash = await bcrypt.hash(String(payload.employeePin), 10);

  return inTransaction(client, async () => {
    const employee = await client.query(
      `INSERT INTO employees (name, hourly_rate, pin_hash, active, deleted_at, updated_at)
       VALUES ($1, $2, $3, true, NULL, now())
       ON CONFLICT (name) DO UPDATE SET hourly_rate=EXCLUDED.hourly_rate, pin_hash=EXCLUDED.pin_hash,
         active=true, deleted_at=NULL, updated_at=now()
       RETURNING id`,
      [name, rate, pinHash]
    );
    await logAdmin(client, "Add Employee", employee.rows[0].id, "employee", null, { employee: name });
    await queueSheetSync(client, env, "Add Employee", payload);
    return `Success: ${name} added.`;
  });
}

async function updateEmployee(client: DbClient, payload: ActionPayload, env: Env): Promise<string> {
  const name = requiredString(payload.employeeName, "Employee name", 120);
  const changes: string[] = [];
  const values: unknown[] = [];

  if (String(payload.hourlyRate ?? "").trim() !== "") {
    values.push(numberAtLeastZero(payload.hourlyRate, "Hourly rate"));
    changes.push(`hourly_rate=$${values.length}`);
  }
  if (String(payload.employeePin ?? "").trim() !== "") {
    if (!validPin(payload.employeePin)) throw new Error("PIN must be exactly 4 digits.");
    values.push(await bcrypt.hash(String(payload.employeePin), 10));
    changes.push(`pin_hash=$${values.length}`);
  }
  if (!changes.length) throw new Error("No employee changes were provided.");

  values.push(name);
  return inTransaction(client, async () => {
    const updated = await client.query(
      `UPDATE employees SET ${changes.join(", ")}, updated_at=now()
       WHERE name=$${values.length} AND deleted_at IS NULL RETURNING id`,
      values
    );
    if (!updated.rowCount) throw new Error("Employee was not found.");
    await logAdmin(client, "Update Employee", updated.rows[0].id, "employee", null, { employee: name });
    await queueSheetSync(client, env, "Update Employee", payload);
    return `Success: ${name} updated.`;
  });
}

async function setEmployeeActive(client: DbClient, payload: ActionPayload, active: boolean, env: Env): Promise<string> {
  const name = requiredString(payload.employeeName, "Employee name", 120);
  return inTransaction(client, async () => {
    const updated = await client.query(
      "UPDATE employees SET active=$1, updated_at=now() WHERE name=$2 AND deleted_at IS NULL RETURNING id",
      [active, name]
    );
    if (!updated.rowCount) throw new Error("Employee was not found.");
    const action = active ? "Reactivate Employee" : "Deactivate Employee";
    await logAdmin(client, action, updated.rows[0].id, "employee", null, { employee: name });
    await queueSheetSync(client, env, action, payload);
    return `Success: ${name} ${active ? "reactivated" : "deactivated"}.`;
  });
}

async function deleteEmployee(client: DbClient, payload: ActionPayload, env: Env): Promise<string> {
  const name = requiredString(payload.employeeName, "Employee name", 120);
  return inTransaction(client, async () => {
    const updated = await client.query(
      `UPDATE employees SET deleted_at=now(), updated_at=now()
       WHERE name=$1 AND active=false AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM shifts WHERE employee_id=employees.id AND clock_out_at IS NULL)
       RETURNING id`,
      [name]
    );
    if (!updated.rowCount) throw new Error("Only an inactive employee with no open shift can be deleted.");
    await logAdmin(client, "Delete Employee", updated.rows[0].id, "employee", null, { employee: name, historyPreserved: true });
    await queueSheetSync(client, env, "Delete Employee", payload);
    return `Success: ${name} removed; shift history was preserved.`;
  });
}

async function updateMissedPunchStatus(client: DbClient, payload: ActionPayload): Promise<string> {
  const rowNumber = Number(payload.rowNumber);
  if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) throw new Error("Invalid missed-punch request.");
  const status = normalizeStatus(payload.status);
  if (status === "pending") throw new Error("Choose Approved or Rejected.");

  return inTransaction(client, async () => {
    const request = await client.query(
      `SELECT r.*, e.name::text AS employee_name, e.hourly_rate
       FROM missed_punch_requests r JOIN employees e ON e.id=r.employee_id
       WHERE r.admin_row_number=$1 FOR UPDATE`,
      [rowNumber]
    );
    if (!request.rowCount) throw new Error("Missed-punch request was not found.");
    const item = request.rows[0];
    if (item.status !== "pending") return `Success: Request is already ${item.status}.`;

    let resultingShiftId: string | null = null;
    if (status === "approved") {
      const open = await client.query(
        "SELECT id, clock_in_at, rate_at_shift FROM shifts WHERE employee_id=$1 AND clock_out_at IS NULL FOR UPDATE",
        [item.employee_id]
      );
      if (!open.rowCount) throw new Error("This employee no longer has an open shift to correct.");

      const shift = open.rows[0];
      const closed = await client.query(
        `UPDATE shifts
         SET clock_out_at=($2::date + $3::time) AT TIME ZONE 'America/Detroit',
             recorded_hours=round((extract(epoch FROM ((($2::date + $3::time) AT TIME ZONE 'America/Detroit')-clock_in_at))/3600.0)::numeric, 4),
             recorded_projected_pay=round(((extract(epoch FROM ((($2::date + $3::time) AT TIME ZONE 'America/Detroit')-clock_in_at))/3600.0)*COALESCE(rate_at_shift,$4))::numeric, 2),
             source='missed_punch_approved', updated_at=now()
         WHERE id=$1 AND (($2::date + $3::time) AT TIME ZONE 'America/Detroit') >= clock_in_at
         RETURNING id`,
        [shift.id, item.requested_date, item.requested_time, item.hourly_rate]
      );
      if (!closed.rowCount) throw new Error("Requested clock-out time is earlier than the clock-in time.");
      resultingShiftId = closed.rows[0].id;
    }

    await client.query(
      "UPDATE missed_punch_requests SET status=$1, reviewed_at=now(), resulting_shift_id=$2 WHERE id=$3",
      [status, resultingShiftId, item.id]
    );
    await logAdmin(client, "Update Missed Punch Status", item.employee_id, "missed_punch", String(rowNumber), {
      employee: item.employee_name,
      status
    });
    return `Success: Request ${status}.`;
  });
}

async function getMissedPunchRequests(client: DbClient): Promise<string> {
  const result = await client.query(`
    SELECT r.admin_row_number AS "rowNumber", e.name::text AS name, r.request_type AS type,
           to_char(r.requested_date, 'MM/DD/YYYY') AS "requestedDate",
           to_char(r.requested_time, 'FMHH12:MI AM') AS "requestedTime",
           initcap(r.status) AS status
    FROM missed_punch_requests r JOIN employees e ON e.id=r.employee_id
    ORDER BY r.created_at DESC LIMIT 250
  `);
  return jsonText(result.rows);
}

async function getEmployeeDetails(client: DbClient, payload: ActionPayload): Promise<string> {
  const name = requiredString(payload.employeeName, "Employee name", 120);
  const result = await client.query(`
    SELECT json_build_object(
      'active', e.active,
      'rate', e.hourly_rate,
      'totalHours', COALESCE((SELECT round(sum(hours),2) FROM payroll_completed_shifts WHERE employee_id=e.id),0),
      'totalPay', COALESCE((SELECT round(sum(projected_pay),2) FROM payroll_completed_shifts WHERE employee_id=e.id),0),
      'openShift', (SELECT json_build_object(
        'date', to_char(s.clock_in_at AT TIME ZONE 'America/Detroit','MM/DD/YYYY'),
        'clockIn', to_char(s.clock_in_at AT TIME ZONE 'America/Detroit','FMHH12:MI AM')
      ) FROM shifts s WHERE s.employee_id=e.id AND s.clock_out_at IS NULL LIMIT 1),
      'recentPunches', COALESCE((SELECT json_agg(row_to_json(p) ORDER BY p.sort_at DESC) FROM (
        SELECT to_char(s.clock_in_at AT TIME ZONE 'America/Detroit','MM/DD/YYYY') AS date,
               trim(to_char(s.clock_in_at AT TIME ZONE 'America/Detroit','Day')) AS day,
               to_char(s.clock_in_at AT TIME ZONE 'America/Detroit','FMHH12:MI AM') AS "clockIn",
               CASE WHEN s.clock_out_at IS NULL THEN NULL ELSE to_char(s.clock_out_at AT TIME ZONE 'America/Detroit','FMHH12:MI AM') END AS "clockOut",
               CASE WHEN s.clock_out_at IS NULL THEN 0 ELSE round(extract(epoch FROM (s.clock_out_at-s.clock_in_at))/3600.0,2) END AS hours,
               CASE WHEN s.clock_out_at IS NULL THEN 0 ELSE round((extract(epoch FROM (s.clock_out_at-s.clock_in_at))/3600.0)*COALESCE(s.rate_at_shift,e.hourly_rate),2) END AS pay,
               s.clock_in_at AS sort_at
        FROM shifts s WHERE s.employee_id=e.id ORDER BY s.clock_in_at DESC LIMIT 20
      ) p),'[]'::json),
      'missedPunchRequests', COALESCE((SELECT json_agg(row_to_json(rq) ORDER BY rq.sort_at DESC) FROM (
        SELECT r.request_type AS type, to_char(r.requested_date,'MM/DD/YYYY') AS "requestedDate",
               to_char(r.requested_time,'FMHH12:MI AM') AS "requestedTime", initcap(r.status) AS status,
               r.created_at AS sort_at
        FROM missed_punch_requests r WHERE r.employee_id=e.id ORDER BY r.created_at DESC LIMIT 20
      ) rq),'[]'::json)
    ) AS details
    FROM employees e WHERE e.name=$1 LIMIT 1
  `, [name]);
  if (!result.rowCount) throw new Error("Employee was not found.");
  return jsonText(result.rows[0].details);
}

async function getAdminActivityLog(client: DbClient): Promise<string> {
  const result = await client.query(`
    SELECT a.action,
           e.name::text AS employee,
           to_char(a.created_at AT TIME ZONE 'America/Detroit','MM/DD/YYYY FMHH12:MI AM') AS timestamp,
           COALESCE(a.details->>'message', a.details->>'status', '') AS details
    FROM admin_activity_log a LEFT JOIN employees e ON e.id=a.employee_id
    ORDER BY a.created_at DESC LIMIT 100
  `);
  return jsonText(result.rows);
}

function payrollRange(payload: ActionPayload): { start: string | null; end: string | null; label: string } {
  const mode = String(payload.rangeMode ?? "");
  if (mode === "custom") {
    if (!validIsoDate(payload.startDate) || !validIsoDate(payload.endDate)) throw new Error("Choose valid payroll dates.");
    if (String(payload.startDate) > String(payload.endDate)) throw new Error("Payroll start date must be before the end date.");
    return { start: String(payload.startDate), end: String(payload.endDate), label: "Custom Range" };
  }
  if (mode === "this-week") return { start: null, end: null, label: "This Week" };
  if (mode === "last-week") return { start: null, end: null, label: "Last Week" };
  if (mode === "this-month") return { start: null, end: null, label: "This Month" };
  throw new Error("Choose a valid payroll range.");
}

async function getPayrollRange(client: DbClient, payload: ActionPayload): Promise<string> {
  const range = payrollRange(payload);
  const mode = String(payload.rangeMode);
  const result = await client.query(`
    WITH local_today AS (
      SELECT (now() AT TIME ZONE 'America/Detroit')::date AS today
    ), bounds AS (
      SELECT
        CASE
          WHEN $1='custom' THEN $2::date
          WHEN $1='this-week' THEN today - (extract(isodow FROM today)::int - 1)
          WHEN $1='last-week' THEN today - (extract(isodow FROM today)::int - 1) - 7
          WHEN $1='this-month' THEN date_trunc('month',today)::date
        END AS start_date,
        CASE
          WHEN $1='custom' THEN $3::date
          WHEN $1='this-week' THEN today
          WHEN $1='last-week' THEN today - extract(isodow FROM today)::int
          WHEN $1='this-month' THEN today
        END AS end_date
      FROM local_today
    ), items AS (
      SELECT p.name, round(sum(p.hours),2) AS hours, round(sum(p.projected_pay),2) AS pay
      FROM payroll_completed_shifts p, bounds b
      WHERE (p.clock_in_at AT TIME ZONE 'America/Detroit')::date BETWEEN b.start_date AND b.end_date
      GROUP BY p.name
    )
    SELECT json_build_object(
      'label',$4,
      'startDate',to_char(b.start_date,'MM/DD/YYYY'),
      'endDate',to_char(b.end_date,'MM/DD/YYYY'),
      'items',COALESCE((SELECT json_agg(json_build_object('name',name::text,'hours',hours,'pay',pay) ORDER BY name) FROM items),'[]'::json),
      'totalHours',COALESCE((SELECT round(sum(hours),2) FROM items),0),
      'totalPay',COALESCE((SELECT round(sum(pay),2) FROM items),0)
    ) AS payroll
    FROM bounds b
  `, [mode, range.start, range.end, range.label]);
  return jsonText(result.rows[0].payroll);
}

async function logAdmin(
  client: DbClient,
  action: string,
  employeeId: string | null,
  targetType: string,
  targetId: string | null,
  details: Record<string, unknown>
): Promise<void> {
  await client.query(
    "INSERT INTO admin_activity_log (action, employee_id, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5::jsonb)",
    [action, employeeId, targetType, targetId, JSON.stringify(details)]
  );
}

async function handleAdminAction(client: DbClient, payload: ActionPayload, env: Env): Promise<string> {
  const action = String(payload.action);
  switch (action) {
    case "Get Admin Dashboard": return getAdminDashboard(client);
    case "Add Employee": return addEmployee(client, payload, env);
    case "Update Employee": return updateEmployee(client, payload, env);
    case "Deactivate Employee": return setEmployeeActive(client, payload, false, env);
    case "Reactivate Employee": return setEmployeeActive(client, payload, true, env);
    case "Delete Employee": return deleteEmployee(client, payload, env);
    case "Update Missed Punch Status": return updateMissedPunchStatus(client, payload);
    case "Get Employee Details": return getEmployeeDetails(client, payload);
    case "Get Admin Activity Log": return getAdminActivityLog(client);
    case "Get Payroll Range": return getPayrollRange(client, payload);
    case "Get Missed Punch Requests": return getMissedPunchRequests(client);
    default: throw new Error("Unsupported admin action.");
  }
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    if (new URL(request.url).pathname === "/api/health") {
      return Response.json({ ok: true, environment: env.APP_ENV }, { headers: { "cache-control": "no-store" } });
    }
    return textResponse("Not found.", 404);
  }
  if (request.method !== "POST") return textResponse("Method not allowed.", 405, { allow: "GET, POST" });

  try {
    assertSameOrigin(request);
    const payload = await readPayload(request);
    const action = requiredString(payload.action, "Action", 80);

    if (action === "Verify Admin") {
      const result = await verifyAdmin(payload, env);
      return textResponse(result.body, 200, result.headers);
    }

    const isAdmin = action !== "Get Employees" && action !== "Clock In" && action !== "Clock Out" && action !== "Submit Missed Punch";
    if (isAdmin) payload.adminPin = await assertAdmin(request, env);

    if (!env.NEON_DATABASE_URL) throw new Error("Staging database connection is not configured.");

    if (action === "Get Employees" || isReadAction(action)) {
      const sql = neon(env.NEON_DATABASE_URL, { fullResults: true });
      const readClient: DbClient = {
        query: (text, values = []) => sql.query(text, values) as Promise<DbResult>
      };
      let body: string;
      if (action === "Get Employees") body = await getEmployees(readClient);
      else body = await handleAdminAction(readClient, payload, env);

      const headers: Record<string, string> = {};
      if (action === "Get Employees") headers["cache-control"] = "private, max-age=60";
      else headers["cache-control"] = "no-store";
      return textResponse(body, 200, headers);
    }

    const client = new Client({ connectionString: env.NEON_DATABASE_URL });
    await client.connect();
    try {
      let body: string;
      if (action === "Clock In") body = await clockIn(client, payload, request, env);
      else if (action === "Clock Out") body = await clockOut(client, payload, request, env);
      else if (action === "Submit Missed Punch") body = await submitMissedPunch(client, payload, env);
      else body = await handleAdminAction(client, payload, env);

      const headers: Record<string, string> = {};
      return textResponse(body, 200, headers);
    } finally {
      await client.end().catch(() => undefined);
    }
  } catch (error) {
    console.error("API request failed", error instanceof Error ? error.message : "Unknown error");
    return textResponse(formatError(error), 200);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      const response = await handleApi(request, env);
      if (request.method === "POST") ctx.waitUntil(flushSheetOutbox(env));
      return response;
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(flushSheetOutbox(env));
  }
} satisfies ExportedHandler<Env>;
