// Permanent delete extension for inactive employees only.
// Kept separate from admin.js so normal dashboard refresh logic stays lightweight.

(function () {
  const originalDisplayEmployees = window.displayEmployees;

  if (typeof originalDisplayEmployees !== "function") return;

  window.displayEmployees = function (employees) {
    originalDisplayEmployees(employees);

    const rows = document.querySelectorAll("#employeeManagementList .employee-management-row");

    rows.forEach((row, index) => {
      const employee = employees[index];
      if (!employee || employee.active === true) return;

      const actions = row.querySelector(".employee-management-actions");
      if (!actions || actions.querySelector(".admin-delete-permanent")) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-reject admin-delete-permanent";
      button.textContent = "Delete Permanently";
      button.addEventListener("click", () => permanentDeleteEmployee(employee.name));
      actions.appendChild(button);
    });
  };
})();

function permanentDeleteEmployee(employeeName) {
  openModal({
    title: "Permanently delete employee?",
    subtitle: employeeName,
    confirmText: "Delete Permanently",
    confirmClass: "danger",
    body: `
      <div class="warning-panel">
        <strong>This cannot be undone.</strong>
        <p>This removes the employee profile from the Employees sheet. Existing attendance and payroll history are left intact.</p>
      </div>
      <label class="modal-label" for="modalDeleteConfirm">Type DELETE to confirm</label>
      <input id="modalDeleteConfirm" class="modal-field" type="text" autocomplete="off" placeholder="DELETE">
    `,
    onConfirm: async () => {
      const field = document.getElementById("modalDeleteConfirm");
      if (!field || field.value.trim().toUpperCase() !== "DELETE") {
        setModalError("Type DELETE exactly to permanently remove this employee.");
        if (field) field.focus();
        return;
      }

      closeAdminModal();
      await deleteEmployeePermanently(employeeName);
    }
  });
}

async function deleteEmployeePermanently(employeeName) {
  setAdminStatus(`Deleting ${employeeName}...`, "processing");
  setAdminBusy(true);

  try {
    const message = await postToBackend({
      action: "Delete Employee",
      adminPin: ADMIN_PIN,
      employeeName
    });

    if (message.startsWith("Success")) {
      showToast(`${employeeName} permanently deleted.`, "success");
      dashboardSignatures.employees = null;
      dashboardSignatures.analytics = null;
      await loadAdminDashboard({ quiet: true });
      setAdminStatus("Employee deleted.", "success");
    } else {
      setAdminStatus(message, "error");
      showToast(message, "error");
    }
  } catch (error) {
    console.error(error);
    setAdminStatus("Error: Could not permanently delete employee.", "error");
    showToast("Could not permanently delete employee.", "error");
  } finally {
    setAdminBusy(false);
  }
}
