// Triumph Training final admin feature pass.
// Adds long-shift warnings, on-demand payroll filtering/export, and missed-punch filters.
// Heavy reads only run when the admin uses those controls.

const LONG_SHIFT_HOURS = 8;

// State must be initialized BEFORE setupPayrollTools() runs.
// Keeping this above bootstrap prevents temporal-dead-zone errors across dynamically loaded scripts.
let lastDashboardPayroll = [];
let activePayrollItems = [];
let activePayrollLabel = "Current Dashboard";
let payrollMode = "dashboard";
let fullMissedPunchRequests = null;
let missedPunchToolsActive = false;

(function () {
  const originalRenderClockedIn = window.renderClockedIn;
  if (typeof originalRenderClockedIn === "function") {
    window.renderClockedIn = function (employees) {
      originalRenderClockedIn(employees);
      applyLongShiftWarnings(employees, LONG_SHIFT_HOURS);
    };
  }

  setupPayrollTools();
  setupMissedPunchTools();
})();

function parseTriumphDateTime(dateText, timeText) {
  const dateMatch = String(dateText || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const timeMatch = String(timeText || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!dateMatch || !timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const suffix = timeMatch[3].toUpperCase();
  if (suffix === "PM" && hour !== 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;

  return new Date(
    Number(dateMatch[3]),
    Number(dateMatch[1]) - 1,
    Number(dateMatch[2]),
    hour,
    minute
  );
}

function applyLongShiftWarnings(employees, thresholdHours) {
  const rows = document.querySelectorAll("#clockedInList .clocked-row");

  rows.forEach((row, index) => {
    const employee = employees[index];
    if (!employee) return;

    const started = parseTriumphDateTime(employee.date, employee.clockIn);
    if (!started) return;

    const elapsedHours = (Date.now() - started.getTime()) / 3600000;
    if (elapsedHours < thresholdHours) return;

    row.classList.add("long-shift-row");
    if (row.querySelector(".long-shift-warning")) return;

    const warning = document.createElement("div");
    warning.className = "long-shift-warning";
    warning.setAttribute("role", "status");
    warning.textContent = `Long shift · ${elapsedHours.toFixed(1)} hrs`;
    row.appendChild(warning);
  });
}

function setupPayrollTools() {
  const payrollContainer = document.getElementById("payrollSummary");
  if (!payrollContainer) return;

  const section = payrollContainer.closest(".admin-section");
  const headingRow = section && section.querySelector(".section-heading-row");
  if (!section || !headingRow || document.getElementById("payrollRangeSelect")) return;

  const originalRenderPayroll = window.renderPayroll;
  if (typeof originalRenderPayroll === "function") {
    window.renderPayroll = function (items) {
      lastDashboardPayroll = Array.isArray(items) ? items : [];
      if (payrollMode === "dashboard") {
        activePayrollItems = lastDashboardPayroll;
        activePayrollLabel = "Current Dashboard";
        originalRenderPayroll(lastDashboardPayroll);
        updatePayrollRangeSummary();
      }
    };
    window.__triumphOriginalRenderPayroll = originalRenderPayroll;
  }

  const tools = document.createElement("div");
  tools.className = "final-admin-tools payroll-tools";
  tools.innerHTML = `
    <select id="payrollRangeSelect" aria-label="Payroll date range">
      <option value="dashboard">Current Dashboard</option>
      <option value="this-week">This Week</option>
      <option value="last-week">Last Week</option>
      <option value="this-month">This Month</option>
      <option value="custom">Custom Range</option>
    </select>
    <div id="payrollCustomDates" class="payroll-custom-dates" hidden>
      <input id="payrollStartDate" type="date" aria-label="Payroll start date">
      <input id="payrollEndDate" type="date" aria-label="Payroll end date">
      <button type="button" class="admin-small-button secondary" onclick="loadPayrollRange()">Apply</button>
    </div>
    <button id="exportPayrollButton" type="button" class="admin-small-button secondary" onclick="exportPayrollCsv()">Export CSV</button>
  `;

  section.insertBefore(tools, payrollContainer);

  const summary = document.createElement("div");
  summary.id = "payrollRangeSummary";
  summary.className = "payroll-range-summary";
  section.insertBefore(summary, payrollContainer);

  document.getElementById("payrollRangeSelect").addEventListener("change", handlePayrollRangeChange);
  updatePayrollRangeSummary();
}

function handlePayrollRangeChange(event) {
  const mode = event.target.value;
  const custom = document.getElementById("payrollCustomDates");
  if (custom) custom.hidden = mode !== "custom";

  if (mode === "dashboard") {
    payrollMode = "dashboard";
    activePayrollItems = lastDashboardPayroll;
    activePayrollLabel = "Current Dashboard";
    if (typeof window.__triumphOriginalRenderPayroll === "function") {
      window.__triumphOriginalRenderPayroll(lastDashboardPayroll);
    }
    updatePayrollRangeSummary();
    return;
  }

  if (mode !== "custom") loadPayrollRange();
}

async function loadPayrollRange() {
  const select = document.getElementById("payrollRangeSelect");
  if (!select) return;

  const mode = select.value;
  const startDate = document.getElementById("payrollStartDate")?.value || "";
  const endDate = document.getElementById("payrollEndDate")?.value || "";

  if (mode === "custom" && (!startDate || !endDate)) {
    showToast("Choose both payroll dates.", "error");
    return;
  }

  select.disabled = true;
  setAdminStatus("Loading payroll range...", "processing");

  try {
    const text = await postToBackend({
      action: "Get Payroll Range",
      adminPin: ADMIN_PIN,
      rangeMode: mode,
      startDate,
      endDate
    });

    if (text.startsWith("Error:")) throw new Error(text);
    const data = JSON.parse(text);

    payrollMode = mode;
    activePayrollItems = Array.isArray(data.items) ? data.items : [];
    activePayrollLabel = data.label || "Payroll Range";

    if (typeof window.__triumphOriginalRenderPayroll === "function") {
      window.__triumphOriginalRenderPayroll(activePayrollItems);
    }

    updatePayrollRangeSummary(data);
    setAdminStatus("Payroll range loaded.", "success");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not load payroll range.", "error");
    setAdminStatus("Error: Could not load payroll range.", "error");
  } finally {
    select.disabled = false;
  }
}

function updatePayrollRangeSummary(data) {
  const summary = document.getElementById("payrollRangeSummary");
  if (!summary) return;

  const items = activePayrollItems || [];
  const totalHours = data && Number.isFinite(Number(data.totalHours))
    ? Number(data.totalHours)
    : items.reduce((sum, item) => sum + Number(item.hours || 0), 0);
  const totalPay = data && Number.isFinite(Number(data.totalPay))
    ? Number(data.totalPay)
    : items.reduce((sum, item) => sum + Number(item.pay || 0), 0);

  const dates = data && data.startDate && data.endDate
    ? ` · ${escapeHtml(data.startDate)}–${escapeHtml(data.endDate)}`
    : "";

  summary.innerHTML = `<strong>${escapeHtml(activePayrollLabel)}</strong>${dates}<span>${totalHours.toFixed(2)} hrs · $${totalPay.toFixed(2)}</span>`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function exportPayrollCsv() {
  if (!activePayrollItems.length) {
    showToast("There is no payroll data to export.", "error");
    return;
  }

  const rows = [
    ["Employee", "Hours", "Projected Pay"],
    ...activePayrollItems.map(item => [
      item.name || "",
      Number(item.hours || 0).toFixed(2),
      Number(item.pay || 0).toFixed(2)
    ])
  ];

  const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const safeLabel = activePayrollLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "payroll";
  link.href = URL.createObjectURL(blob);
  link.download = `triumph-${safeLabel}.csv`;
  document.body.appendChild(link);
  link.click();
  const objectUrl = link.href;
  link.remove();
  URL.revokeObjectURL(objectUrl);
  showToast("Payroll CSV exported.", "success");
}

function setupMissedPunchTools() {
  const container = document.getElementById("missedPunchRequests");
  if (!container) return;

  const section = container.closest(".admin-section");
  if (!section || document.getElementById("missedPunchStatusFilter")) return;

  const tools = document.createElement("div");
  tools.className = "final-admin-tools missed-punch-tools";
  tools.innerHTML = `
    <input id="missedPunchSearch" type="search" placeholder="Search employee..." aria-label="Search missed punch requests">
    <select id="missedPunchStatusFilter" aria-label="Filter missed punch requests by status">
      <option value="all">All Statuses</option>
      <option value="pending">Pending</option>
      <option value="approved">Approved</option>
      <option value="rejected">Rejected</option>
    </select>
    <button id="loadMissedPunchHistoryButton" type="button" class="admin-small-button secondary">Load Full History</button>
  `;
  section.insertBefore(tools, container);

  document.getElementById("missedPunchSearch").addEventListener("input", activateMissedPunchFilters);
  document.getElementById("missedPunchStatusFilter").addEventListener("change", activateMissedPunchFilters);
  document.getElementById("loadMissedPunchHistoryButton").addEventListener("click", loadFullMissedPunchHistory);

  const originalUpdate = window.updateMissedPunchStatus;
  if (typeof originalUpdate === "function") {
    window.updateMissedPunchStatus = async function (rowNumber, status) {
      await originalUpdate(rowNumber, status);
      fullMissedPunchRequests = null;
      if (missedPunchToolsActive) await loadFullMissedPunchHistory(true);
    };
  }
}

async function activateMissedPunchFilters() {
  missedPunchToolsActive = true;
  if (!fullMissedPunchRequests) {
    await loadFullMissedPunchHistory(true);
  } else {
    applyMissedPunchFilters();
  }
}

async function loadFullMissedPunchHistory(quiet = false) {
  const button = document.getElementById("loadMissedPunchHistoryButton");
  if (!button) return;

  missedPunchToolsActive = true;
  button.disabled = true;
  if (!quiet) button.textContent = "Loading…";

  try {
    const text = await postToBackend({
      action: "Get Missed Punch Requests",
      adminPin: ADMIN_PIN
    });

    if (text.startsWith("Error:")) throw new Error(text);
    fullMissedPunchRequests = JSON.parse(text);
    if (!Array.isArray(fullMissedPunchRequests)) fullMissedPunchRequests = [];
    applyMissedPunchFilters();
    button.textContent = "Refresh History";
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not load missed-punch history.", "error");
    button.textContent = "Try Again";
  } finally {
    button.disabled = false;
  }
}

function applyMissedPunchFilters() {
  if (!Array.isArray(fullMissedPunchRequests)) return;

  const search = String(document.getElementById("missedPunchSearch")?.value || "").trim().toLowerCase();
  const status = String(document.getElementById("missedPunchStatusFilter")?.value || "all").toLowerCase();

  const filtered = fullMissedPunchRequests.filter(item => {
    const matchesSearch = !search || String(item.name || "").toLowerCase().includes(search);
    const itemStatus = String(item.status || "Pending").toLowerCase();
    const matchesStatus = status === "all" || itemStatus === status;
    return matchesSearch && matchesStatus;
  });

  renderMissedPunches(filtered);
}
