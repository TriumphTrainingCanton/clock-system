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
