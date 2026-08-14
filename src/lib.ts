export type ActionPayload = Record<string, unknown> & { action?: unknown };

const READ_ACTIONS = new Set([
  "Get Employees",
  "Get Admin Dashboard",
  "Get Employee Details",
  "Get Admin Activity Log",
  "Get Payroll Range",
  "Get Missed Punch Requests"
]);

export function isReadAction(action: string): boolean {
  return READ_ACTIONS.has(action);
}

export function requiredString(value: unknown, label: string, max = 200): string {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} is required.`);
  if (result.length > max) throw new Error(`${label} is too long.`);
  return result;
}

export function validPin(value: unknown): value is string {
  return /^\d{4}$/.test(String(value ?? ""));
}

export function validRequestId(value: unknown): value is string {
  return /^[A-Za-z0-9_-]{8,80}$/.test(String(value ?? ""));
}

export function validIsoDate(value: unknown): value is string {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

export function validTime(value: unknown): value is string {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? ""));
}

export function numberAtLeastZero(value: unknown, label: string): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be zero or greater.`);
  return result;
}

export function normalizeStatus(value: unknown): "pending" | "approved" | "rejected" {
  const status = String(value ?? "").trim().toLowerCase();
  if (status === "approved" || status === "rejected" || status === "pending") return status;
  throw new Error("Status must be Approved or Rejected.");
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(header.split(";").map(part => {
    const index = part.indexOf("=");
    if (index < 0) return [part.trim(), ""];
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
}

export function formatError(error: unknown): string {
  if (error instanceof Error && error.message) return `Error: ${error.message}`;
  return "Error: The request could not be completed.";
}
