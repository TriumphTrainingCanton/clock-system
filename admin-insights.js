// Triumph Training admin insights.
// Employee details and activity history load only when requested.
// System health measures the existing dashboard request without adding another request.

(function () {
  if (typeof postToBackend !== "function") return;

  const measuredPostToBackend = postToBackend;

  postToBackend = async function (payload) {
    const isDashboardRead = payload && payload.action === "Get Admin Dashboard";
    const started = isDashboardRead ? performance.now() : 0;

    try {
      const result = await measuredPostToBackend(payload);

      if (isDashboardRead) {
        updateSystemHealth(true, Math.round(performance.now() - started));
      }

      return result;
    } catch (error) {
      if (isDashboardRead) {
        updateSystemHealth(false, Math.round(performance.now() - started));
      }
      throw error;
    }
  };

  const originalDisplayEmployees = window.displayEmployees;
  if (typeof originalDisplayEmployees !== "function") return;

  window.displayEmployees = function (employees) {
    originalDisplayEmployees(employees);

    const rows = document.querySelectorAll("#employeeManagementList .employee-management-row");

    rows.forEach((row, index) => {
      const employee = employees[index];
      if (!employee) return;

      const actions = row.querySelector(".employee-management-actions");
      if (!actions || actions.querySelector(".admin-view-details")) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-small-button secondary admin-view-details";
      button.textContent = "View Details";
      button.setAttribute("aria-label", `View details for ${employee.name}`);
      button.addEventListener("click", () => openEmployeeDetails(employee.name));
      actions.prepend(button);
    });
  };
})();

function updateSystemHealth(isOnline, responseMs) {
  const badge = document.getElementById("systemHealthBadge");
  const detail = document.getElementById("systemHealthDetail");
  if (!badge || !detail) return;

  badge.className = `system-health-badge ${isOnline ? "online" : "offline"}`;
  badge.textContent = isOnline ? "Backend Online" : "Backend Issue";

  if (!isOnline) {
    detail.textContent = responseMs ? `Last attempt failed after ${responseMs} ms` : "Dashboard request failed";
    return;
  }

  let speed = "Fast";
  if (responseMs >= 2500) speed = "Slow";
  else if (responseMs >= 1200) speed = "Normal";

  detail.textContent = `${speed} · ${responseMs} ms`;
}

function setInfoModalMode() {
  const cancelButton = document.querySelector("#adminModal .modal-cancel");
  const confirmButton = document.getElementById("modalConfirmButton");
  if (cancelButton) cancelButton.style.display = "none";
  if (confirmButton) confirmButton.textContent = "Close";
}

function restoreModalButtons() {
  const cancelButton = document.querySelector("#adminModal .modal-cancel");
  if (cancelButton) cancelButton.style.display = "";
}

async function openEmployeeDetails(employeeName) {
  restoreModalButtons();
  openModal({
    title: "Employee Details",
    subtitle: employeeName,
    confirmText: "Close",
    body: '<div class="insight-loading">Loading employee details…</div>',
    onConfirm: async () => closeAdminModal()
  });
  setInfoModalMode();

  try {
    const text = await postToBackend({
      action: "Get Employee Details",
      adminPin: ADMIN_PIN,
      employeeName
    });

    if (text.startsWith("Error:")) throw new Error(text);
    const data = JSON.parse(text);
    renderEmployeeDetails(data);
  } catch (error) {
    console.error(error);
    const body = document.getElementById("modalBody");
    if (body) {
      body.innerHTML = `
        <div class="insight-error">
          <strong>Could not load employee details.</strong>
          <p>${escapeHtml(error.message || "Please try again.")}</p>
        </div>
      `;
    }
  }
}

function renderEmployeeDetails(data) {
  const body = document.getElementById("modalBody");
  if (!body) return;

  const punches = Array.isArray(data.recentPunches) ? data.recentPunches : [];
  const requests = Array.isArray(data.missedPunchRequests) ? data.missedPunchRequests : [];

  const punchMarkup = punches.length
    ? punches.map(item => `
        <div class="insight-list-row">
          <div>
            <strong>${escapeHtml(item.date || "")}</strong>
            <span>${escapeHtml(item.day || "")}</span>
          </div>
          <div class="insight-list-right">
            <strong>${escapeHtml(item.clockIn || "")} → ${escapeHtml(item.clockOut || "Open")}</strong>
            <span>${Number(item.hours || 0).toFixed(2)} hrs · $${Number(item.pay || 0).toFixed(2)}</span>
          </div>
        </div>
      `).join("")
    : '<div class="empty-state">No punch history found.</div>';

  const requestMarkup = requests.length
    ? requests.map(item => `
        <div class="insight-list-row">
          <div>
            <strong>${escapeHtml(item.type || "Request")}</strong>
            <span>${escapeHtml(item.requestedDate || "")} ${escapeHtml(item.requestedTime || "")}</span>
          </div>
          <span class="status-pill ${statusClassForInsight(item.status)}">${escapeHtml(item.status || "Pending")}</span>
        </div>
      `).join("")
    : '<div class="empty-state">No missed-punch requests found.</div>';

  body.innerHTML = `
    <div class="employee-detail-summary">
      <div class="detail-stat"><span>Status</span><strong>${data.active ? "Active" : "Inactive"}</strong></div>
      <div class="detail-stat"><span>Hourly Rate</span><strong>$${Number(data.rate || 0).toFixed(2)}</strong></div>
      <div class="detail-stat"><span>Total Hours</span><strong>${Number(data.totalHours || 0).toFixed(2)}</strong></div>
      <div class="detail-stat"><span>Projected Pay</span><strong>$${Number(data.totalPay || 0).toFixed(2)}</strong></div>
    </div>

    ${data.openShift ? `
      <div class="open-shift-alert">
        <strong>Currently clocked in</strong>
        <span>${escapeHtml(data.openShift.date || "")} at ${escapeHtml(data.openShift.clockIn || "")}</span>
      </div>
    ` : ""}

    <div class="insight-block">
      <h3>Recent Punches</h3>
      ${punchMarkup}
    </div>

    <div class="insight-block">
      <h3>Missed-Punch History</h3>
      ${requestMarkup}
    </div>
  `;
}

function statusClassForInsight(status) {
  const value = String(status || "Pending").toLowerCase();
  if (value === "approved") return "active";
  if (value === "rejected") return "inactive";
  return "pending";
}

async function loadAdminActivityLog() {
  const container = document.getElementById("adminActivityLog");
  const button = document.getElementById("loadActivityButton");
  if (!container || !button) return;

  button.disabled = true;
  button.textContent = "Loading…";
  container.innerHTML = '<div class="insight-loading">Loading admin activity…</div>';

  try {
    const text = await postToBackend({
      action: "Get Admin Activity Log",
      adminPin: ADMIN_PIN
    });

    if (text.startsWith("Error:")) throw new Error(text);
    const items = JSON.parse(text);
    renderAdminActivityLog(Array.isArray(items) ? items : []);
    button.textContent = "Refresh Activity";
  } catch (error) {
    console.error(error);
    container.innerHTML = `
      <div class="insight-error">
        <strong>Could not load the activity log.</strong>
        <p>${escapeHtml(error.message || "Please try again.")}</p>
      </div>
    `;
    button.textContent = "Try Again";
  } finally {
    button.disabled = false;
  }
}

function renderAdminActivityLog(items) {
  const container = document.getElementById("adminActivityLog");
  if (!container) return;

  if (!items.length) {
    container.innerHTML = '<div class="empty-state">No admin activity has been recorded yet.</div>';
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="activity-log-row">
      <div class="activity-marker" aria-hidden="true"></div>
      <div class="activity-copy">
        <div class="activity-topline">
          <strong>${escapeHtml(item.action || "Admin Action")}</strong>
          <span>${escapeHtml(item.timestamp || "")}</span>
        </div>
        <div class="activity-meta">
          ${item.employee ? `<span>${escapeHtml(item.employee)}</span>` : ""}
          ${item.details ? `<span>${escapeHtml(item.details)}</span>` : ""}
        </div>
      </div>
    </div>
  `).join("");
}
