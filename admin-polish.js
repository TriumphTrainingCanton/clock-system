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
  if (!Array.isArray(activePayrollItems) || !activePayrollItems.length) {
    showToast("There is no payroll data to export.", "error");
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

  // Delay revocation slightly so slower browsers can finish starting the download.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  showToast("Payroll CSV exported.", "success");
};

// Payroll should never sit on "Loading..." indefinitely.
// This override keeps the UI responsive and surfaces the actual backend response.
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

  const exportButton = document.getElementById("exportPayrollButton");
  const originalSelectDisabled = select.disabled;
  const originalExportDisabled = exportButton ? exportButton.disabled : false;

  select.disabled = true;
  if (exportButton) exportButton.disabled = true;
  setAdminStatus("Loading payroll range...", "processing");

  let uiTimeout;

  try {
    const request = postToBackend({
      action: "Get Payroll Range",
      adminPin: ADMIN_PIN,
      rangeMode: mode,
      startDate,
      endDate
    });

    const timeout = new Promise((_, reject) => {
      uiTimeout = setTimeout(() => {
        reject(new Error("Payroll range request took too long. The Apps Script deployment may be outdated or Google may be responding slowly."));
      }, 14000);
    });

    const text = await Promise.race([request, timeout]);

    if (String(text || "").startsWith("Error:")) {
      throw new Error(String(text));
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error("Payroll backend returned invalid data instead of payroll JSON.");
    }

    if (!data || typeof data !== "object" || !Array.isArray(data.items)) {
      throw new Error("Payroll backend returned an incomplete payroll response.");
    }

    payrollMode = mode;
    activePayrollItems = data.items;
    activePayrollLabel = data.label || "Payroll Range";

    if (typeof window.__triumphOriginalRenderPayroll === "function") {
      window.__triumphOriginalRenderPayroll(activePayrollItems);
    }

    updatePayrollRangeSummary(data);
    setAdminStatus("Payroll range loaded.", "success");

    if (!activePayrollItems.length) {
      showToast("Payroll range loaded — no completed payroll rows found in this range.", "success");
    }
  } catch (error) {
    console.error("Payroll range load failed.", error);
    const message = String(error && error.message ? error.message : "Could not load payroll range.");
    setAdminStatus(`Error: ${message}`, "error");
    showToast(message, "error");
  } finally {
    clearTimeout(uiTimeout);
    select.disabled = originalSelectDisabled;
    if (exportButton) exportButton.disabled = originalExportDisabled;
  }
};
