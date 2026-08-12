const url = "https://script.google.com/macros/s/AKfycbwidHd1FgdRr3fUx2uqAAbBE3tUFGcFKOxqzN-lI7HT_-EFtaeVHMtRITl9faMdmyiDLA/exec";

const ADMIN_PIN = "1976";
let allEmployees = [];
let pendingAdminRequests = 0;

// =====================================================
// STATUS / BUSY STATE
// =====================================================

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
  const controls = document.querySelectorAll(
    "#dashboard button, #dashboard input, #dashboard select"
  );

  controls.forEach(control => {
    control.disabled = busy;
  });

  const dashboard = document.getElementById("dashboard");
  if (dashboard) {
    dashboard.setAttribute("aria-busy", busy ? "true" : "false");
  }
}

async function postToBackend(payload) {
  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  const text = (await response.text()).trim();

  if (
    text.startsWith("<!DOCTYPE html") ||
    text.startsWith("<html")
  ) {
    throw new Error("Backend returned HTML instead of data.");
  }

  return text;
}

// =====================================================
// ADMIN LOGIN
// =====================================================

function unlockAdmin() {
  const pin = document.getElementById("adminPin").value.trim();
  const dashboard = document.getElementById("dashboard");
  const loginPanel = document.getElementById("loginPanel");

  if (pin !== ADMIN_PIN) {
    setAdminStatus("Error: Incorrect Admin PIN.", "error");
    dashboard.style.display = "none";
    return;
  }

  setAdminStatus("Admin Dashboard Unlocked.", "success");
  loginPanel.style.display = "none";
  dashboard.style.display = "block";
  loadAdminDashboard();
}

// =====================================================
// LOAD DASHBOARD
// =====================================================

async function loadAdminDashboard() {
  setAdminStatus("Refreshing dashboard...", "processing");
  setAdminBusy(true);

  try {
    const text = await postToBackend({
      action: "Get Admin Dashboard",
      adminPin: ADMIN_PIN
    });

    const data = JSON.parse(text);

    updateDashboardCards(data);
    renderClockedIn(data.clockedIn || []);
    renderEmployees(data.employees || []);
    renderPayroll(data.payrollSummary || []);
    renderAnalytics(data.analytics || {});
    renderMissedPunches(data.missedPunchRequests || []);
    renderRecentPunches(data.recentPunches || []);

    setAdminStatus("Dashboard updated.", "success");
  } catch (error) {
    console.error(error);
    setAdminStatus(
      "Error: Could not load dashboard. Please refresh and try again.",
      "error"
    );
  } finally {
    setAdminBusy(false);
  }
}

// =====================================================
// TOP SUMMARY CARDS
// =====================================================

function updateDashboardCards(data) {
  const stats = data.analytics || {};

  const clocked = document.getElementById("clockedCount");
  const employees = document.getElementById("employeeCount");
  const requests = document.getElementById("requestCount");
  const pay = document.getElementById("projectedPay");

  if (clocked) clocked.innerText = stats.activeCount || 0;
  if (employees) employees.innerText = stats.totalEmployees || 0;
  if (requests) requests.innerText = stats.pendingMissedRequests || 0;
  if (pay) {
    pay.innerText = "$" + Number(stats.totalProjectedPay || 0).toFixed(2);
  }
}

// =====================================================
// CLOCKED IN LIST
// =====================================================

function renderClockedIn(employees) {
  const container = document.getElementById("clockedInList");
  if (!container) return;

  if (employees.length === 0) {
    container.innerHTML = `
      <div class="empty-state">No employees currently clocked in.</div>
    `;
    return;
  }

  container.innerHTML = employees.map(employee => `
    <div class="admin-row">
      <div>
        <strong>${employee.name}</strong><br>
        <span>Clocked in: ${employee.clockIn}</span>
      </div>
      <span class="employee-active">ACTIVE</span>
    </div>
  `).join("");
}

// =====================================================
// ADD EMPLOYEE
// =====================================================

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

  setAdminStatus("Adding employee...", "processing");
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
      setAdminStatus(message, "success");
      await loadAdminDashboard();
    } else {
      setAdminStatus(message, "error");
    }
  } catch (error) {
    console.error(error);
    setAdminStatus("Error: Could not add employee.", "error");
  } finally {
    setAdminBusy(false);
  }
}

// =====================================================
// EMPLOYEE MANAGEMENT
// =====================================================

function renderEmployees(employees) {
  allEmployees = employees;
  displayEmployees(employees);
}

function displayEmployees(employees) {
  const container = document.getElementById("employeeManagementList");
  if (!container) return;

  if (employees.length === 0) {
    container.innerHTML = '<div class="empty-state">No employees found.</div>';
    return;
  }

  container.innerHTML = employees.map(employee => {
    const status = employee.active ? "Active" : "Inactive";
    const statusClass = employee.active ? "employee-active" : "employee-inactive";

    const statusButton = employee.active
      ? `
        <button type="button" class="admin-reject"
          onclick="deactivateEmployee('${escapeQuotes(employee.name)}')">
          Remove
        </button>
      `
      : `
        <button type="button" class="admin-approve"
          onclick="reactivateEmployee('${escapeQuotes(employee.name)}')">
          Reactivate
        </button>
      `;

    return `
      <div class="employee-management-row">
        <div class="employee-management-info">
          <strong>${employee.name}</strong><br>
          $${Number(employee.rate || 0).toFixed(2)} / hr<br>
          <span class="${statusClass}">${status}</span>
        </div>

        <div class="employee-management-actions">
          <button type="button" class="admin-small-button"
            onclick="editEmployeeRate('${escapeQuotes(employee.name)}', ${Number(employee.rate || 0)})">
            Edit Pay
          </button>

          <button type="button" class="admin-small-button"
            onclick="resetEmployeePin('${escapeQuotes(employee.name)}')">
            Reset PIN
          </button>

          ${statusButton}
        </div>
      </div>
    `;
  }).join("");
}

function filterEmployees() {
  const search = document.getElementById("employeeSearch").value.toLowerCase();
  const filter = document.getElementById("employeeFilter").value;

  const filtered = allEmployees.filter(employee => {
    const matchesName = employee.name.toLowerCase().includes(search);
    let matchesStatus = true;

    if (filter === "active") matchesStatus = employee.active === true;
    if (filter === "inactive") matchesStatus = employee.active === false;

    return matchesName && matchesStatus;
  });

  displayEmployees(filtered);
}

// =====================================================
// EDIT PAY
// =====================================================

async function editEmployeeRate(employeeName, currentRate) {
  const newRate = prompt(
    "Enter new hourly rate for " + employeeName,
    currentRate
  );

  if (newRate === null) return;

  if (
    newRate.trim() === "" ||
    isNaN(Number(newRate)) ||
    Number(newRate) < 0
  ) {
    setAdminStatus("Error: Invalid hourly rate.", "error");
    return;
  }

  await updateEmployee(employeeName, newRate, "");
}

// =====================================================
// RESET PIN
// =====================================================

async function resetEmployeePin(employeeName) {
  const newPin = prompt("Enter new 4-digit PIN for " + employeeName);

  if (newPin === null) return;

  if (!/^\d{4}$/.test(newPin.trim())) {
    setAdminStatus("Error: PIN must be exactly 4 digits.", "error");
    return;
  }

  await updateEmployee(employeeName, "", newPin.trim());
}

// =====================================================
// UPDATE EMPLOYEE
// =====================================================

async function updateEmployee(employeeName, hourlyRate, employeePin) {
  setAdminStatus("Updating employee...", "processing");
  setAdminBusy(true);

  try {
    const message = await postToBackend({
      action: "Update Employee",
      adminPin: ADMIN_PIN,
      employeeName,
      hourlyRate,
      employeePin
    });

    if (message.startsWith("Success")) {
      setAdminStatus(message, "success");
      await loadAdminDashboard();
    } else {
      setAdminStatus(message, "error");
    }
  } catch (error) {
    console.error(error);
    setAdminStatus("Error: Could not update employee.", "error");
  } finally {
    setAdminBusy(false);
  }
}

// =====================================================
// REMOVE / REACTIVATE EMPLOYEE
// =====================================================

async function deactivateEmployee(employeeName) {
  const confirmRemove = confirm(
    "Remove " + employeeName + " from active employees?"
  );

  if (!confirmRemove) return;

  await changeEmployeeStatus("Deactivate Employee", employeeName);
}

async function reactivateEmployee(employeeName) {
  await changeEmployeeStatus("Reactivate Employee", employeeName);
}

async function changeEmployeeStatus(action, employeeName) {
  setAdminStatus("Updating employee status...", "processing");
  setAdminBusy(true);

  try {
    const message = await postToBackend({
      action,
      adminPin: ADMIN_PIN,
      employeeName
    });

    if (message.startsWith("Success")) {
      setAdminStatus(message, "success");
      await loadAdminDashboard();
    } else {
      setAdminStatus(message, "error");
    }
  } catch (error) {
    console.error(error);
    setAdminStatus("Error: Could not update employee status.", "error");
  } finally {
    setAdminBusy(false);
  }
}

// =====================================================
// PAYROLL
// =====================================================

function renderPayroll(items) {
  const container = document.getElementById("payrollSummary");
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">No payroll data yet.</div>';
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="admin-row">
      <div><strong>${item.name}</strong></div>
      <div>
        ${Number(item.hours || 0).toFixed(2)} hrs
        &nbsp; | &nbsp;
        $${Number(item.pay || 0).toFixed(2)}
      </div>
    </div>
  `).join("");
}

// =====================================================
// ANALYTICS
// =====================================================

function renderAnalytics(data) {
  const container = document.getElementById("analyticsBox");
  if (!container) return;

  container.innerHTML = `
    <div class="admin-row">
      <span>Active Employees</span>
      <strong>${data.totalEmployees || 0}</strong>
    </div>
    <div class="admin-row">
      <span>Currently Clocked In</span>
      <strong>${data.activeCount || 0}</strong>
    </div>
    <div class="admin-row">
      <span>Completed Shifts</span>
      <strong>${data.completedShifts || 0}</strong>
    </div>
    <div class="admin-row">
      <span>Pending Requests</span>
      <strong>${data.pendingMissedRequests || 0}</strong>
    </div>
    <div class="admin-row">
      <span>Projected Payroll</span>
      <strong>$${Number(data.totalProjectedPay || 0).toFixed(2)}</strong>
    </div>
  `;
}

// =====================================================
// MISSED PUNCH REQUESTS
// =====================================================

function renderMissedPunches(items) {
  const container = document.getElementById("missedPunchRequests");
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">No missed punch requests.</div>';
    return;
  }

  container.innerHTML = items.map(request => {
    const pending = String(request.status || "Pending").toLowerCase() === "pending";

    return `
      <div class="request-card">
        <strong>${request.name}</strong><br>
        ${request.type || ""}<br>
        ${request.requestedDate || ""}&nbsp;${request.requestedTime || ""}<br>
        Status: <strong>${request.status || "Pending"}</strong>

        ${pending ? `
          <div class="request-actions">
            <button type="button" class="admin-approve"
              onclick="updateMissedPunchStatus(${request.rowNumber}, 'Approved')">
              Approve
            </button>
            <button type="button" class="admin-reject"
              onclick="updateMissedPunchStatus(${request.rowNumber}, 'Rejected')">
              Reject
            </button>
          </div>
        ` : ""}
      </div>
    `;
  }).join("");
}

// =====================================================
// UPDATE MISSED PUNCH
// =====================================================

async function updateMissedPunchStatus(rowNumber, status) {
  setAdminStatus("Updating request...", "processing");
  setAdminBusy(true);

  try {
    const message = await postToBackend({
      action: "Update Missed Punch Status",
      adminPin: ADMIN_PIN,
      rowNumber,
      status
    });

    if (message.startsWith("Success")) {
      setAdminStatus(message, "success");
      await loadAdminDashboard();
    } else {
      setAdminStatus(message, "error");
    }
  } catch (error) {
    console.error(error);
    setAdminStatus("Error: Could not update request.", "error");
  } finally {
    setAdminBusy(false);
  }
}

// =====================================================
// RECENT PUNCHES
// =====================================================

function renderRecentPunches(items) {
  const container = document.getElementById("recentPunches");
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">No recent punches.</div>';
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="admin-row">
      <div>
        <strong>${item.name}</strong><br>
        ${item.date || ""}
      </div>
      <div>
        ${item.clockIn || ""}&nbsp; → &nbsp;${item.clockOut || "Open"}<br>
        ${Number(item.hours || 0).toFixed(2)} hrs
      </div>
    </div>
  `).join("");
}

// =====================================================
// ESCAPE QUOTES
// =====================================================

function escapeQuotes(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}
