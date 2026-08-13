// Final reliability/export polish for Triumph Training admin.
// Loaded after the feature bundles so these small overrides stay isolated.

window.updateSystemHealth = function (isOnline, responseMs) {
  const badge = document.getElementById("systemHealthBadge");
  const detail = document.getElementById("systemHealthDetail");
  if (!badge || !detail) return;

  if (window.__triumphDashboardUsedCache) {
    badge.className = "system-health-badge offline";
    badge.textContent = "Cached Dashboard";
    detail.textContent = "Google response delayed · keeping last successful data";
    return;
  }

  badge.className = `system-health-badge ${isOnline ? "online" : "offline"}`;
  badge.textContent = isOnline ? "Backend Online" : "Backend Issue";

  if (!isOnline) {
    detail.textContent = responseMs
      ? `Last attempt failed after ${responseMs} ms`
      : "Dashboard request failed";
    return;
  }

  let speed = "Fast";
  if (responseMs >= 2500) speed = "Slow";
  else if (responseMs >= 1200) speed = "Normal";

  detail.textContent = `${speed} · ${responseMs} ms`;
};

function triumphCsvSafeValue(value) {
  let text = String(value ?? "");

  // Prevent spreadsheet programs from treating a text cell as a formula.
  if (/^[=+\-@]/.test(text)) text = "'" + text;

  return `"${text.replace(/"/g, '""')}"`;
}

window.exportPayrollCsv = function () {
  // Export is intentionally 100% local. It never waits on Apps Script.
  if (!Array.isArray(activePayrollItems) || !activePayrollItems.length) {
    showToast("There is no payroll data to export for this range.", "error");
    return;
  }

  const totalHours = activePayrollItems.reduce(
    (sum, item) => sum + Number(item.hours || 0),
    0
  );
  const totalPay = activePayrollItems.reduce(
    (sum, item) => sum + Number(item.pay || 0),
    0
  );

  const rows = [
    ["Triumph Training Payroll Export"],
    ["Range", activePayrollLabel || "Current Dashboard"],
    [],
    ["Employee", "Hours", "Projected Pay"],
    ...activePayrollItems.map(item => [
      item.name || "",
      Number(item.hours || 0).toFixed(2),
      Number(item.pay || 0).toFixed(2)
    ]),
    [],
    ["TOTAL", totalHours.toFixed(2), totalPay.toFixed(2)]
  ];

  const csv = "\uFEFF" + rows
    .map(row => row.map(triumphCsvSafeValue).join(","))
    .join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeLabel = String(activePayrollLabel || "payroll")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "payroll";

  link.href = objectUrl;
  link.download = `triumph-${safeLabel}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  showToast("Payroll CSV exported instantly.", "success");
};

const TRIUMPH_PAYROLL_CACHE_KEY = "triumph_admin_payroll_ranges_v2";
const TRIUMPH_PAYROLL_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const triumphPayrollRefreshes = new Map();

function triumphPayrollCacheId(mode, startDate, endDate) {
  return [mode || "dashboard", startDate || "", endDate || ""].join("|");
}

function readTriumphPayrollCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRIUMPH_PAYROLL_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function getTriumphPayrollCache(mode, startDate, endDate) {
  const cache = readTriumphPayrollCache();
  const entry = cache[triumphPayrollCacheId(mode, startDate, endDate)];
  if (!entry || !entry.savedAt || !entry.data) return null;
  if (Date.now() - Number(entry.savedAt) > TRIUMPH_PAYROLL_CACHE_MAX_AGE_MS) return null;
  if (!Array.isArray(entry.data.items)) return null;
  return entry;
}

function saveTriumphPayrollCache(mode, startDate, endDate, data) {
  try {
    const cache = readTriumphPayrollCache();
    cache[triumphPayrollCacheId(mode, startDate, endDate)] = {
      savedAt: Date.now(),
      data
    };
    localStorage.setItem(TRIUMPH_PAYROLL_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn("Payroll cache could not be saved.", error);
  }
}

function applyTriumphPayrollData(data, options = {}) {
  payrollMode = options.mode || payrollMode;
  activePayrollItems = Array.isArray(data.items) ? data.items : [];
  activePayrollLabel = data.label || "Payroll Range";

  if (typeof window.__triumphOriginalRenderPayroll === "function") {
    window.__triumphOriginalRenderPayroll(activePayrollItems);
  }

  updatePayrollRangeSummary(data);

  if (options.fromCache) {
    const ageMinutes = Math.max(0, Math.round((Date.now() - Number(options.savedAt || Date.now())) / 60000));
    setAdminStatus(
      ageMinutes <= 1
        ? "Payroll ready from saved data. Checking for updates quietly..."
        : `Payroll ready instantly from saved data (${ageMinutes} min old). Checking for updates quietly...`,
      "success"
    );
  } else {
    setAdminStatus("Payroll range updated.", "success");
  }
}

async function requestTriumphPayrollRange(mode, startDate, endDate, timeoutMs = 18000) {
  let timeoutId;
  try {
    const request = postToBackend({
      action: "Get Payroll Range",
      adminPin: ADMIN_PIN,
      rangeMode: mode,
      startDate,
      endDate
    });

    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Payroll refresh timed out.")), timeoutMs);
    });

    const text = await Promise.race([request, timeout]);
    if (String(text || "").startsWith("Error:")) throw new Error(String(text));

    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error("Payroll backend returned invalid data.");
    }

    if (!data || typeof data !== "object" || !Array.isArray(data.items)) {
      throw new Error("Payroll backend returned an incomplete payroll response.");
    }

    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isCurrentTriumphPayrollSelection(mode, startDate, endDate) {
  const select = document.getElementById("payrollRangeSelect");
  if (!select || select.value !== mode) return false;
  if (mode !== "custom") return true;
  return (
    (document.getElementById("payrollStartDate")?.value || "") === startDate &&
    (document.getElementById("payrollEndDate")?.value || "") === endDate
  );
}

async function refreshTriumphPayrollInBackground(mode, startDate, endDate) {
  const key = triumphPayrollCacheId(mode, startDate, endDate);
  if (triumphPayrollRefreshes.has(key)) return triumphPayrollRefreshes.get(key);

  const refreshPromise = (async () => {
    try {
      const data = await requestTriumphPayrollRange(mode, startDate, endDate, 20000);
      saveTriumphPayrollCache(mode, startDate, endDate, data);

      if (isCurrentTriumphPayrollSelection(mode, startDate, endDate)) {
        applyTriumphPayrollData(data, { mode, fromCache: false });
      }
      return data;
    } catch (error) {
      console.warn("Background payroll refresh failed; saved payroll remains available.", error);
      return null;
    } finally {
      triumphPayrollRefreshes.delete(key);
    }
  })();

  triumphPayrollRefreshes.set(key, refreshPromise);
  return refreshPromise;
}

// Permanent fast-path for payroll ranges:
// 1) use the last successful range immediately;
// 2) refresh quietly in the background;
// 3) only wait on Google the very first time a range has never been loaded.
window.loadPayrollRange = async function () {
  const select = document.getElementById("payrollRangeSelect");
  if (!select) return;

  const mode = select.value;
  const startDate = document.getElementById("payrollStartDate")?.value || "";
  const endDate = document.getElementById("payrollEndDate")?.value || "";

  if (mode === "custom" && (!startDate || !endDate)) {
    showToast("Choose both payroll dates.", "error");
    return;
  }

  const cached = getTriumphPayrollCache(mode, startDate, endDate);
  if (cached) {
    applyTriumphPayrollData(cached.data, {
      mode,
      fromCache: true,
      savedAt: cached.savedAt
    });

    // Do not block the admin. Fresh data replaces the saved result when ready.
    refreshTriumphPayrollInBackground(mode, startDate, endDate);
    return;
  }

  const exportButton = document.getElementById("exportPayrollButton");
  select.disabled = true;
  if (exportButton) exportButton.disabled = true;
  setAdminStatus("Loading this payroll range for the first time...", "processing");

  try {
    const data = await requestTriumphPayrollRange(mode, startDate, endDate, 18000);
    saveTriumphPayrollCache(mode, startDate, endDate, data);
    applyTriumphPayrollData(data, { mode, fromCache: false });

    if (!activePayrollItems.length) {
      showToast("Payroll loaded — no completed payroll rows found in this range.", "success");
    }
  } catch (error) {
    console.error("Payroll range load failed.", error);
    const message = String(error && error.message ? error.message : "Could not load payroll range.");
    setAdminStatus(`Error: ${message}`, "error");
    showToast(message, "error");
  } finally {
    select.disabled = false;
    if (exportButton) exportButton.disabled = false;
  }
};
