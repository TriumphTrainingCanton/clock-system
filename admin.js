const url = "https://script.google.com/macros/s/AKfycbyQL6m6KbI3by8pzWayyvf4CA_zDnmAqJRwG9wZkcQWkJcPFZOMfC7IYyG1U4Rdye6SXA/exec";

const ADMIN_PIN = "9274";

function setAdminStatus(message, type) {
  const status = document.getElementById("status");
  status.className = type;
  status.innerText = message;
}

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
  dashboard.style.display = "block";
  loginPanel.style.display = "none";

  loadAdminDashboard();
}

function loadAdminDashboard() {
  setAdminStatus("Refreshing dashboard...", "processing");

  fetch(url, {
    method: "POST",
    body: JSON.stringify({
      action: "Admin Dashboard Data",
      adminPin: ADMIN_PIN
    })
  })
  .then(res => res.text())
  .then(data => {
    let dashboardData;

    try {
      dashboardData = JSON.parse(data);
    } catch {
      setAdminStatus("Error: Could not load admin dashboard.", "error");
      return;
    }

    renderClockedIn(dashboardData.clockedIn || []);
    renderPayrollSummary(dashboardData.payrollSummary || []);
    renderEmployeeRates(dashboardData.employees || []);
    renderAnalytics(dashboardData.analytics || {});
    renderMissedPunchRequests(dashboardData.missedPunchRequests || []);
    renderRecentPunches(dashboardData.recentPunches || []);

    setAdminStatus("Dashboard updated.", "success");
  })
  .catch(() => {
    setAdminStatus("Connection error. Try again.", "error");
  });
}

function renderClockedIn(employees) {
  const container = document.getElementById("clockedInList");

  if (employees.length === 0) {
    container.innerHTML = "No employees currently clocked in.";
    return;
  }

  container.innerHTML = employees
    .map(person => `
      <div class="admin-row">
        <span>🟢 ${person.name}</span>
        <span>${person.clockIn || ""}</span>
      </div>
    `)
    .join("");
}

function renderPayrollSummary(summary) {
  const container = document.getElementById("payrollSummary");

  if (summary.length === 0) {
    container.innerHTML = "No completed paid shifts yet.";
    return;
  }

  container.innerHTML = summary
    .map(item => `
      <div class="admin-row">
        <span>${item.name}</span>
        <span>${Number(item.hours).toFixed(2)} hrs / $${Number(item.pay).toFixed(2)}</span>
      </div>
    `)
    .join("");
}

function renderEmployeeRates(employees) {
  const container = document.getElementById("employeeRates");

  if (employees.length === 0) {
    container.innerHTML = "No employees found.";
    return;
  }

  container.innerHTML = employees
    .map(employee => `
      <div class="admin-row">
        <span>${employee.name}</span>
        <span>$${Number(employee.rate || 0).toFixed(2)}/hr</span>
      </div>
    `)
    .join("");
}

function renderAnalytics(analytics) {
  const container = document.getElementById("analyticsBox");

  container.innerHTML = `
    <div class="admin-row">
      <span>Total Employees</span>
      <span>${analytics.totalEmployees || 0}</span>
    </div>
    <div class="admin-row">
      <span>Currently Clocked In</span>
      <span>${analytics.activeCount || 0}</span>
    </div>
    <div class="admin-row">
      <span>Completed Shifts</span>
      <span>${analytics.completedShifts || 0}</span>
    </div>
    <div class="admin-row">
      <span>Open Missed Requests</span>
      <span>${analytics.pendingMissedRequests || 0}</span>
    </div>
    <div class="admin-row">
      <span>Total Projected Pay</span>
      <span>$${Number(analytics.totalProjectedPay || 0).toFixed(2)}</span>
    </div>
  `;
}

function renderMissedPunchRequests(requests) {
  const container = document.getElementById("missedPunchRequests");

  if (requests.length === 0) {
    container.innerHTML = "No missed punch requests.";
    return;
  }

  container.innerHTML = requests
    .map(request => `
      <div class="request-card">
        <div><strong>${request.name}</strong> — ${request.type}</div>
        <div>${request.requestedDate || ""} ${request.requestedTime || ""}</div>
        <div>Reason: ${request.reason || "No reason provided"}</div>
        <div>Status: <strong>${request.status || "Pending"}</strong></div>
        <div class="request-actions">
          <button class="admin-approve" onclick="updateMissedPunchStatus(${request.rowNumber}, 'Approved')">Approve</button>
          <button class="admin-reject" onclick="updateMissedPunchStatus(${request.rowNumber}, 'Rejected')">Reject</button>
        </div>
      </div>
    `)
    .join("");
}

function renderRecentPunches(punches) {
  const container = document.getElementById("recentPunches");

  if (punches.length === 0) {
    container.innerHTML = "No recent punches found.";
    return;
  }

  container.innerHTML = punches
    .map(punch => `
      <div class="admin-row recent-row">
        <span>${punch.name}</span>
        <span>${punch.date} — In: ${punch.clockIn || ""} / Out: ${punch.clockOut || "Open"}</span>
      </div>
    `)
    .join("");
}

function updateMissedPunchStatus(rowNumber, status) {
  setAdminStatus("Updating request...", "processing");

  fetch(url, {
    method: "POST",
    body: JSON.stringify({
      action: "Update Missed Punch Status",
      adminPin: ADMIN_PIN,
      rowNumber: rowNumber,
      status: status
    })
  })
  .then(res => res.text())
  .then(message => {
    if (message.startsWith("Success")) {
      setAdminStatus(message, "success");
      loadAdminDashboard();
    } else {
      setAdminStatus(message, "error");
    }
  })
  .catch(() => {
    setAdminStatus("Connection error. Try again.", "error");
  });
}
