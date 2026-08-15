const IS_LEGACY_PAGES = window.location.hostname === "clock-system.pages.dev";
const LEGACY_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwidHd1FgdRr3fUx2uqAAbBE3tUFGcFKOxqzN-lI7HT_-EFtaeVHMtRITl9faMdmyiDLA/exec";
const url = IS_LEGACY_PAGES ? LEGACY_APPS_SCRIPT_URL : "/api";

let ADMIN_PIN = "";
let allEmployees = [];
let pendingAdminRequests = 0;
let activeModalAction = null;
let lastFocusedElement = null;
let refreshInFlight = false;
let dashboardSignatures = Object.create(null);

function setAdminStatus(message, type) {
  const status = document.getElementById("status");
  if (!status) return;
  status.className = type || "";
  status.innerText = message;
}

function setAdminBusy(isBusy) {
  pendingAdminRequests += isBusy ? 1 : -1;
  pendingAdminRequests = Math.max(0, pendingAdminRequests);
  const busy = pendingAdminRequests > 0;

  document.querySelectorAll("#dashboard button, #dashboard input, #dashboard select").forEach(control => {
    control.disabled = busy;
  });

  const dashboard = document.getElementById("dashboard");
  if (dashboard) dashboard.setAttribute("aria-busy", busy ? "true" : "false");
}

function setRefreshBusy(isBusy) {
  const button = document.getElementById("refreshDashboardButton");
  if (!button) return;

  button.disabled = isBusy;
  button.textContent = isBusy ? "Refreshing..." : "Refresh Dashboard";
  button.setAttribute("aria-busy", isBusy ? "true" : "false");
}

async function postToBackend(payload) {
  const mutationActions = new Set([
    "Add Employee",
    "Update Employee",
    "Deactivate Employee",
    "Reactivate Employee",
    "Delete Employee",
    "Update Missed Punch Status"
  ]);
  if (mutationActions.has(String(payload.action)) && !payload.requestId) {
    payload = {
      ...payload,
      requestId: (crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "")
    };
  }
  const response = await fetch(url, {
    method: "POST",
    ...(IS_LEGACY_PAGES ? {} : {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin"
    }),
    body: JSON.stringify(payload)
  });

  const text = (await response.text()).trim();
  if (text.startsWith("<!DOCTYPE html") || text.startsWith("<html")) {
    throw new Error("Backend returned HTML instead of data.");
  }
  return text;
}

function showToast(message, type = "success") {
  const toast = document.getElementById("adminToast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `admin-toast show ${type}`;
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => {
    toast.className = "admin-toast";
  }, 3200);
}

function setLastUpdated() {
  const updated = document.getElementById("lastUpdated");
  if (!updated) return;
  updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function stableSignature(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch (error) {
    return String(Date.now());
  }
}

function renderIfChanged(key, value, renderer) {
  const signature = stableSignature(value);
  if (dashboardSignatures[key] === signature) return false;

  dashboardSignatures[key] = signature;
  renderer(value);
  return true;
}

async function unlockAdmin() {
  const pin = document.getElementById("adminPin").value.trim();
  const dashboard = document.getElementById("dashboard");
  const loginPanel = document.getElementById("loginPanel");

  if (!/^\d{4}$/.test(pin)) {
    setAdminStatus("Error: Incorrect Admin PIN.", "error");
    dashboard.style.display = "none";
    return;
  }

  setAdminStatus("Verifying Admin PIN...", "processing");
  try {
    const message = await postToBackend({
      action: IS_LEGACY_PAGES ? "Get Admin Dashboard" : "Verify Admin",
      adminPin: pin
    });
    if (IS_LEGACY_PAGES) {
      const verification = JSON.parse(message);
      if (!verification || typeof verification !== "object" || Array.isArray(verification)) throw new Error();
      ADMIN_PIN = pin;
    } else {
      if (!message.startsWith("Success")) throw new Error(message.replace(/^Error:\s*/i, ""));
      ADMIN_PIN = "";
    }
    document.getElementById("adminPin").value = "";
    setAdminStatus("Admin Dashboard Unlocked.", "success");
    loginPanel.style.display = "none";
    dashboard.style.display = "block";
    loadAdminDashboard();
  } catch (error) {
    setAdminStatus(`Error: ${error.message || "Incorrect Admin PIN."}`, "error");
    dashboard.style.display = "none";
  }
}

async function loadAdminDashboard(options = {}) {
  if (refreshInFlight) return;

  refreshInFlight = true;
  const quiet = options.quiet === true;

  if (!quiet) setAdminStatus("Refreshing dashboard...", "processing");
  setRefreshBusy(true);

  try {
    const text = await postToBackend({ action: "Get Admin Dashboard", adminPin: ADMIN_PIN });
    const data = JSON.parse(text);

    const analytics = data.analytics || {};
    const clockedIn = data.clockedIn || [];
    const employees = data.employees || [];
    const payroll = data.payrollSummary || [];
    const missedPunches = data.missedPunchRequests || [];
    const recentPunches = data.recentPunches || [];

    renderIfChanged("analytics", analytics, value => {
      updateDashboardCards({ analytics: value });
      renderAnalytics(value);
    });

    renderIfChanged("clockedIn", clockedIn, renderClockedIn);
    renderIfChanged("employees", employees, renderEmployees);
    renderIfChanged("payroll", payroll, renderPayroll);
    renderIfChanged("missedPunches", missedPunches, renderMissedPunches);
    renderIfChanged("recentPunches", recentPunches, renderRecentPunches);

    setLastUpdated();
    setAdminStatus("Dashboard updated.", "success");
  } catch (error) {
    console.error(error);
    setAdminStatus("Error: Could not load dashboard. Please refresh and try again.", "error");
    showToast("Dashboard refresh failed.", "error");
  } finally {
    refreshInFlight = false;
    setRefreshBusy(false);
  }
}

function updateDashboardCards(data) {
  const stats = data.analytics || {};
  const clocked = document.getElementById("clockedCount");
  const employees = document.getElementById("employeeCount");
  const requests = document.getElementById("requestCount");
  const pay = document.getElementById("projectedPay");

  if (clocked) clocked.innerText = stats.activeCount || 0;
  if (employees) employees.innerText = stats.totalEmployees || 0;
  if (requests) requests.innerText = stats.pendingMissedRequests || 0;
  if (pay) pay.innerText = "$" + Number(stats.totalProjectedPay || 0).toFixed(2);

  const requestCard = document.getElementById("pendingRequestCard");
  if (requestCard) requestCard.classList.toggle("attention", Number(stats.pendingMissedRequests || 0) > 0);

  const clockedCard = document.getElementById("clockedInCard");
  if (clockedCard) clockedCard.classList.toggle("live", Number(stats.activeCount || 0) > 0);
}

function renderClockedIn(employees) {
  const container = document.getElementById("clockedInList");
  if (!container) return;

  if (employees.length === 0) {
    container.innerHTML = '<div class="empty-state">No employees currently clocked in.</div>';
    return;
  }

  container.innerHTML = employees.map(employee => `
    <div class="admin-row clocked-row">
      <div>
        <strong>${escapeHtml(employee.name)}</strong><br>
        <span>Clocked in: ${escapeHtml(employee.clockIn || "")}</span>
      </div>
      <span class="status-pill active">Live</span>
    </div>
  `).join("");
}

async function addEmployee() {
  const employeeName = document.getElementById("newEmployeeName").value.trim();
  const hourlyRate = document.getElementById("newEmployeeRate").value.trim();
  const employeePin = document.getElementById("newEmployeePin").value.trim();

  if (employeeName === "") {
    setAdminStatus("Error: Enter an employee name.", "error");
    return;
  }
  if (hourlyRate === "" || Number(hourlyRate) < 0) {
    setAdminStatus("Error: Enter a valid hourly rate.", "error");
    return;
  }
  if (!/^\d{4}$/.test(employeePin)) {
    setAdminStatus("Error: PIN must be exactly 4 digits.", "error");
    return;
  }

  setAdminStatus(`Adding ${employeeName}...`, "processing");
  setAdminBusy(true);

  try {
    const message = await postToBackend({
      action: "Add Employee",
      adminPin: ADMIN_PIN,
      employeeName,
      hourlyRate,
      employeePin
    });

    if (message.startsWith("Success")) {
      document.getElementById("newEmployeeName").value = "";
      document.getElementById("newEmployeeRate").value = "";
      document.getElementById("newEmployeePin").value = "";
      showToast(`${employeeName} was added.`, "success");
      await loadAdminDashboard({ quiet: true });
    } else {
      setAdminStatus(message, "error");
      showToast(message, "error");
    }
  } catch (error) {
    console.error(error);
    setAdminStatus("Error: Could not add employee.", "error");
    showToast("Could not add employee.", "error");
  } finally {
    setAdminBusy(false);
  }
}

function renderEmployees(employees) {
  allEmployees = employees;
  filterEmployees();
}

function displayEmployees(employees) {
  const container = document.getElementById("employeeManagementList");
  const count = document.getElementById("employeeResultCount");
  if (!container) return;

  if (count) count.textContent = `${employees.length} shown`;
  if (employees.length === 0) {
    container.innerHTML = '<div class="empty-state">No employees match this view.</div>';
    return;
  }

  container.innerHTML = employees.map(employee => {
    const active = employee.active === true;
    const statusClass = active ? "active" : "inactive";
    const initial = escapeHtml(String(employee.name || "?").trim().charAt(0).toUpperCase());
    const safeNameHtml = escapeHtml(employee.name);
    const safeNameJs = escapeQuotes(employee.name);
    const rate = Number(employee.rate || 0);

    return `
      <div class="employee-management-row ${active ? "" : "inactive-row"}">
        <div class="employee-identity">
          <div class="employee-avatar" aria-hidden="true">${initial}</div>
          <div class="employee-management-info">
            <strong>${safeNameHtml}</strong>
            <div class="employee-meta">$${rate.toFixed(2)} / hr</div>
            <span class="status-pill ${statusClass}">${active ? "Active" : "Inactive"}</span>
          </div>
        </div>
        <div class="employee-management-actions">
          <button type="button" class="admin-small-button secondary" onclick="editEmployeeRate('${safeNameJs}', ${rate})">Edit Pay</button>
          <button type="button" class="admin-small-button secondary" onclick="resetEmployeePin('${safeNameJs}')">Reset PIN</button>
          <button type="button" class="${active ? "admin-reject" : "admin-approve"}" onclick="${active ? `deactivateEmployee('${safeNameJs}')` : `reactivateEmployee('${safeNameJs}')`}">${active ? "Deactivate" : "Reactivate"}</button>
        </div>
      </div>
    `;
  }).join("");
}

function filterEmployees() {
  const searchInput = document.getElementById("employeeSearch");
  const filterInput = document.getElementById("employeeFilter");
  const search = searchInput ? searchInput.value.trim().toLowerCase() : "";
  const filter = filterInput ? filterInput.value : "all";

  const filtered = allEmployees.filter(employee => {
    const matchesName = String(employee.name || "").toLowerCase().includes(search);
    let matchesStatus = true;
    if (filter === "active") matchesStatus = employee.active === true;
    if (filter === "inactive") matchesStatus = employee.active === false;
    return matchesName && matchesStatus;
  });

  displayEmployees(filtered);
}

function clearEmployeeSearch() {
  const search = document.getElementById("employeeSearch");
  const filter = document.getElementById("employeeFilter");
  if (search) search.value = "";
  if (filter) filter.value = "all";
  filterEmployees();
  if (search) search.focus();
}

function openModal({ title, subtitle, body, confirmText = "Confirm", confirmClass = "primary", onConfirm }) {
  const modal = document.getElementById("adminModal");
  if (!modal) return;

  lastFocusedElement = document.activeElement;
  activeModalAction = onConfirm;
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalSubtitle").textContent = subtitle || "";
  document.getElementById("modalBody").innerHTML = body;
  document.getElementById("modalError").hidden = true;

  const confirmButton = document.getElementById("modalConfirmButton");
  confirmButton.textContent = confirmText;
  confirmButton.className = `modal-confirm ${confirmClass}`;

  modal.hidden = false;
  document.body.classList.add("modal-open");
  const firstInput = modal.querySelector("input");
  if (firstInput) setTimeout(() => firstInput.focus(), 0);
  else setTimeout(() => confirmButton.focus(), 0);
}

function closeAdminModal() {
  const modal = document.getElementById("adminModal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  activeModalAction = null;
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") lastFocusedElement.focus();
}

async function confirmAdminModal() {
  if (typeof activeModalAction === "function") await activeModalAction();
}

function setModalError(message) {
  const box = document.getElementById("modalError");
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

function editEmployeeRate(employeeName, currentRate) {
  openModal({
    title: "Edit hourly rate",
    subtitle: employeeName,
    confirmText: "Save Pay Rate",
    body: `
      <label class="modal-label" for="modalRate">Hourly rate</label>
      <div class="money-input-wrap">
        <span>$</span>
        <input id="modalRate" type="number" min="0" step="0.01" value="${Number(currentRate || 0).toFixed(2)}" inputmode="decimal">
      </div>
      <p class="modal-help">This updates the employee's hourly rate used by the existing payroll calculation.</p>
    `,
    onConfirm: async () => {
      const field = document.getElementById("modalRate");
      const newRate = field.value.trim();
      if (newRate === "" || isNaN(Number(newRate)) || Number(newRate) < 0) {
        setModalError("Enter a valid hourly rate.");
        field.focus();
        return;
      }
      closeAdminModal();
      await updateEmployee(employeeName, newRate, "");
    }
  });
}

function resetEmployeePin(employeeName) {
  openModal({
    title: "Reset employee PIN",
    subtitle: employeeName,
    confirmText: "Reset PIN",
    body: `
      <label class="modal-label" for="modalPin">New 4-digit PIN</label>
      <input id="modalPin" class="modal-field" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="••••">
      <label class="modal-label" for="modalPinConfirm">Confirm new PIN</label>
      <input id="modalPinConfirm" class="modal-field" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="••••">
      <p class="modal-help">Both entries must match before the PIN can be changed.</p>
    `,
    onConfirm: async () => {
      const pinField = document.getElementById("modalPin");
      const confirmField = document.getElementById("modalPinConfirm");
      const pin = pinField.value.trim();
      const confirmPin = confirmField.value.trim();
      if (!/^\d{4}$/.test(pin)) {
        setModalError("PIN must be exactly 4 digits.");
        pinField.focus();
        return;
      }
      if (pin !== confirmPin) {
        setModalError("PIN entries do not match.");
        confirmField.focus();
        return;
      }
      closeAdminModal();
      await updateEmployee(employeeName, "", pin);
    }
  });
}

function deactivateEmployee(employeeName) {
  openModal({
    title: "Deactivate employee?",
    subtitle: employeeName,
    confirmText: "Deactivate",
    confirmClass: "danger",
    body: `
      <div class="warning-panel">
        <strong>This removes the employee from the active clock-in list.</strong>
        <p>Their existing records remain in the system and they can be reactivated later.</p>
      </div>
    `,
    onConfirm: async () => {
      closeAdminModal();
      await changeEmployeeStatus("Deactivate Employee", employeeName);
    }
  });
}

function reactivateEmployee(employeeName) {
  openModal({
    title: "Reactivate employee?",
    subtitle: employeeName,
    confirmText: "Reactivate",
    body: '<p class="modal-help strong">This employee will be restored to the active clock-in list.</p>',
    onConfirm: async () => {
      closeAdminModal();
      await changeEmployeeStatus("Reactivate Employee", employeeName);
    }
  });
}

async function updateEmployee(employeeName, hourlyRate, employeePin) {
  setAdminStatus(`Updating ${employeeName}...`, "processing");
  setAdminBusy(true);
  try {
    const message = await postToBackend({ action: "Update Employee", adminPin: ADMIN_PIN, employeeName, hourlyRate, employeePin });
    if (message.startsWith("Success")) {
      showToast(`${employeeName} updated.`, "success");
      await loadAdminDashboard({ quiet: true });
    } else {
      setAdminStatus(message, "error");
      showToast(message, "error");
    }
  } catch (error) {
    console.error(error);
    setAdminStatus("Error: Could not update employee.", "error");
    showToast("Could not update employee.", "error");
  } finally {
    setAdminBusy(false);
  }
}

async function changeEmployeeStatus(action, employeeName) {
  setAdminStatus(`Updating ${employeeName}...`, "processing");
  setAdminBusy(true);
  try {
    const message = await postToBackend({ action, adminPin: ADMIN_PIN, employeeName });
    if (message.startsWith("Success")) {
      showToast(`${employeeName} ${action === "Deactivate Employee" ? "deactivated" : "reactivated"}.`, "success");
      await loadAdminDashboard({ quiet: true });
    } else {
      setAdminStatus(message, "error");
      showToast(message, "error");
    }
  } catch (error) {
    console.error(error);
    setAdminStatus("Error: Could not update employee status.", "error");
    showToast("Could not update employee status.", "error");
  } finally {
    setAdminBusy(false);
  }
}

function renderPayroll(items) {
  const container = document.getElementById("payrollSummary");
  if (!container) return;
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">No payroll data yet.</div>';
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="admin-row payroll-row">
      <div><strong>${escapeHtml(item.name)}</strong></div>
      <div class="payroll-numbers"><span>${Number(item.hours || 0).toFixed(2)} hrs</span><strong>$${Number(item.pay || 0).toFixed(2)}</strong></div>
    </div>
  `).join("");
}

function renderAnalytics(data) {
  const container = document.getElementById("analyticsBox");
  if (!container) return;
  container.innerHTML = `
    <div class="admin-row"><span>Active Employees</span><strong>${data.totalEmployees || 0}</strong></div>
    <div class="admin-row"><span>Currently Clocked In</span><strong>${data.activeCount || 0}</strong></div>
    <div class="admin-row"><span>Completed Shifts</span><strong>${data.completedShifts || 0}</strong></div>
    <div class="admin-row"><span>Pending Requests</span><strong>${data.pendingMissedRequests || 0}</strong></div>
    <div class="admin-row"><span>Projected Payroll</span><strong>$${Number(data.totalProjectedPay || 0).toFixed(2)}</strong></div>
  `;
}

function renderMissedPunches(items) {
  const container = document.getElementById("missedPunchRequests");
  if (!container) return;
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">No missed punch requests.</div>';
    return;
  }

  container.innerHTML = items.map(request => {
    const pending = String(request.status || "Pending").toLowerCase() === "pending";
    const statusClass = pending ? "pending" : String(request.status || "").toLowerCase() === "approved" ? "active" : "inactive";
    return `
      <div class="request-card">
        <div class="request-topline"><strong>${escapeHtml(request.name)}</strong><span class="status-pill ${statusClass}">${escapeHtml(request.status || "Pending")}</span></div>
        <div class="request-details"><span>${escapeHtml(request.type || "Request")}</span><span>${escapeHtml(request.requestedDate || "")} ${escapeHtml(request.requestedTime || "")}</span></div>
        ${pending ? `
          <div class="request-actions">
            <button type="button" class="admin-approve" onclick="confirmMissedPunch(${Number(request.rowNumber)}, 'Approved', '${escapeQuotes(request.name)}')">Approve</button>
            <button type="button" class="admin-reject" onclick="confirmMissedPunch(${Number(request.rowNumber)}, 'Rejected', '${escapeQuotes(request.name)}')">Reject</button>
          </div>
        ` : ""}
      </div>
    `;
  }).join("");
}

function confirmMissedPunch(rowNumber, status, employeeName) {
  const approving = status === "Approved";
  openModal({
    title: `${approving ? "Approve" : "Reject"} missed punch?`,
    subtitle: employeeName,
    confirmText: approving ? "Approve Request" : "Reject Request",
    confirmClass: approving ? "primary" : "danger",
    body: `<p class="modal-help strong">This will mark the request as ${status.toLowerCase()}.</p>`,
    onConfirm: async () => {
      closeAdminModal();
      await updateMissedPunchStatus(rowNumber, status);
    }
  });
}

async function updateMissedPunchStatus(rowNumber, status) {
  setAdminStatus(`Marking request ${status.toLowerCase()}...`, "processing");
  setAdminBusy(true);
  try {
    const message = await postToBackend({ action: "Update Missed Punch Status", adminPin: ADMIN_PIN, rowNumber, status });
    if (message.startsWith("Success")) {
      showToast(`Request ${status.toLowerCase()}.`, "success");
      await loadAdminDashboard({ quiet: true });
    } else {
      setAdminStatus(message, "error");
      showToast(message, "error");
    }
  } catch (error) {
    console.error(error);
    setAdminStatus("Error: Could not update request.", "error");
    showToast("Could not update request.", "error");
  } finally {
    setAdminBusy(false);
  }
}

function renderRecentPunches(items) {
  const container = document.getElementById("recentPunches");
  if (!container) return;
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">No recent punches.</div>';
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="admin-row recent-punch-row">
      <div><strong>${escapeHtml(item.name)}</strong><br><span class="muted-text">${escapeHtml(item.date || "")}</span></div>
      <div class="punch-times"><strong>${escapeHtml(item.clockIn || "")} → ${escapeHtml(item.clockOut || "Open")}</strong><span>${Number(item.hours || 0).toFixed(2)} hrs</span></div>
    </div>
  `).join("");
}

function escapeQuotes(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener("keydown", event => {
  const modal = document.getElementById("adminModal");
  if (!modal || modal.hidden) return;
  if (event.key === "Escape") closeAdminModal();
  if (event.key === "Enter" && !event.shiftKey) {
    const active = document.activeElement;
    if (active && active.tagName !== "BUTTON") {
      event.preventDefault();
      confirmAdminModal();
    }
  }
});

document.addEventListener("click", event => {
  const modal = document.getElementById("adminModal");
  if (modal && !modal.hidden && event.target === modal) closeAdminModal();
});
