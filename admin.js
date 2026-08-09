const url = "https://script.google.com/macros/s/AKfycbwidHd1FgdRr3fUx2uqAAbBE3tUFGcFKOxqzN-lI7HT_-EFtaeVHMtRITl9faMdmyiDLA/exec";

const ADMIN_PIN = "9274";


// =====================================================
// STATUS
// =====================================================

function setAdminStatus(message, type) {

  const status =
    document.getElementById("status");

  status.className = type;

  status.innerText = message;
}


// =====================================================
// ADMIN LOGIN
// =====================================================

function unlockAdmin() {

  const pin =
    document
      .getElementById("adminPin")
      .value
      .trim();


  const dashboard =
    document.getElementById("dashboard");


  const loginPanel =
    document.getElementById("loginPanel");


  if (pin !== ADMIN_PIN) {

    setAdminStatus(
      "Error: Incorrect Admin PIN.",
      "error"
    );

    dashboard.style.display =
      "none";

    return;
  }


  setAdminStatus(
    "Admin Dashboard Unlocked.",
    "success"
  );


  loginPanel.style.display =
    "none";


  dashboard.style.display =
    "block";


  loadAdminDashboard();
}


// =====================================================
// LOAD ADMIN DASHBOARD
// =====================================================

async function loadAdminDashboard() {

  setAdminStatus(
    "Refreshing dashboard...",
    "processing"
  );


  try {

    const response =
      await fetch(url, {

        method: "POST",

        body: JSON.stringify({

          action:
            "Get Admin Dashboard",

          adminPin:
            ADMIN_PIN

        })

      });


    const text =
      await response.text();


    if (
      text.trim().startsWith("<!DOCTYPE html") ||
      text.trim().startsWith("<html")
    ) {

      console.error(
        "Unexpected HTML response:",
        text
      );


      setAdminStatus(
        "Error: Backend deployment is not responding correctly.",
        "error"
      );

      return;
    }


    const data =
      JSON.parse(text);


    renderClockedIn(
      data.clockedIn || []
    );


    renderEmployees(
      data.employees || []
    );


    renderPayroll(
      data.payrollSummary || []
    );


    renderAnalytics(
      data.analytics || {}
    );


    renderMissedPunches(
      data.missedPunchRequests || []
    );


    renderRecentPunches(
      data.recentPunches || []
    );


    setAdminStatus(
      "Dashboard updated.",
      "success"
    );


  } catch (error) {

    console.error(
      "Dashboard error:",
      error
    );


    setAdminStatus(
      "Error: Could not load dashboard.",
      "error"
    );

  }
}


// =====================================================
// CURRENTLY CLOCKED IN
// =====================================================

function renderClockedIn(employees) {

  const container =
    document.getElementById(
      "clockedInList"
    );


  if (employees.length === 0) {

    container.innerHTML =
      "No employees currently clocked in.";

    return;
  }


  container.innerHTML =
    employees
      .map(employee => {

        return `
          <div class="admin-row">

            <span>
              <strong>
                ${employee.name}
              </strong>
            </span>

            <span>
              ${employee.clockIn}
            </span>

          </div>
        `;

      })
      .join("");
}


// =====================================================
// ADD EMPLOYEE
// =====================================================

async function addEmployee() {

  const employeeName =
    document
      .getElementById(
        "newEmployeeName"
      )
      .value
      .trim();


  const hourlyRate =
    document
      .getElementById(
        "newEmployeeRate"
      )
      .value
      .trim();


  const employeePin =
    document
      .getElementById(
        "newEmployeePin"
      )
      .value
      .trim();


  if (employeeName === "") {

    setAdminStatus(
      "Error: Enter an employee name.",
      "error"
    );

    return;
  }


  if (
    hourlyRate === "" ||
    Number(hourlyRate) < 0
  ) {

    setAdminStatus(
      "Error: Enter a valid hourly rate.",
      "error"
    );

    return;
  }


  if (!/^\d{4}$/.test(employeePin)) {

    setAdminStatus(
      "Error: PIN must be exactly 4 digits.",
      "error"
    );

    return;
  }


  setAdminStatus(
    "Adding employee...",
    "processing"
  );


  try {

    const response =
      await fetch(url, {

        method: "POST",

        body: JSON.stringify({

          action:
            "Add Employee",

          adminPin:
            ADMIN_PIN,

          employeeName:
            employeeName,

          hourlyRate:
            hourlyRate,

          employeePin:
            employeePin

        })

      });


    const message =
      await response.text();


    if (
      message.startsWith("Success")
    ) {

      setAdminStatus(
        message,
        "success"
      );


      document
        .getElementById(
          "newEmployeeName"
        )
        .value = "";


      document
        .getElementById(
          "newEmployeeRate"
        )
        .value = "";


      document
        .getElementById(
          "newEmployeePin"
        )
        .value = "";


      loadAdminDashboard();


    } else {

      setAdminStatus(
        message,
        "error"
      );

    }


  } catch (error) {

    console.error(error);


    setAdminStatus(
      "Error: Could not add employee.",
      "error"
    );

  }
}


// =====================================================
// EMPLOYEE MANAGEMENT LIST
// =====================================================

function renderEmployees(employees) {

  const container =
    document.getElementById(
      "employeeManagementList"
    );


  if (employees.length === 0) {

    container.innerHTML =
      "No employees found.";

    return;
  }


  container.innerHTML =
    employees
      .map(employee => {

        const statusText =
          employee.active
            ? "Active"
            : "Inactive";


        const statusClass =
          employee.active
            ? "employee-active"
            : "employee-inactive";


        const activeButton =
          employee.active

            ? `
              <button
                class="admin-reject"
                onclick="deactivateEmployee('${escapeQuotes(employee.name)}')">

                Remove

              </button>
            `

            : `
              <button
                class="admin-approve"
                onclick="reactivateEmployee('${escapeQuotes(employee.name)}')">

                Reactivate

              </button>
            `;


        return `

          <div class="employee-management-row">

            <div class="employee-management-info">

              <strong>
                ${employee.name}
              </strong>

              <br>

              $${Number(
                employee.rate || 0
              ).toFixed(2)}/hr

              <br>

              <span class="${statusClass}">
                ${statusText}
              </span>

            </div>


            <div class="employee-management-actions">

              <button
                class="admin-small-button"
                onclick="editEmployeeRate(
                  '${escapeQuotes(employee.name)}',
                  ${Number(employee.rate || 0)}
                )">

                Edit Pay

              </button>


              <button
                class="admin-small-button"
                onclick="resetEmployeePin(
                  '${escapeQuotes(employee.name)}'
                )">

                Reset PIN

              </button>


              ${activeButton}

            </div>

          </div>

        `;

      })
      .join("");
}


// =====================================================
// EDIT HOURLY RATE
// =====================================================

async function editEmployeeRate(
  employeeName,
  currentRate
) {

  const newRate =
    prompt(
      "Enter the new hourly rate for " +
      employeeName +
      ":",
      currentRate
    );


  if (newRate === null) {
    return;
  }


  if (
    newRate.trim() === "" ||
    Number(newRate) < 0 ||
    isNaN(Number(newRate))
  ) {

    setAdminStatus(
      "Error: Enter a valid hourly rate.",
      "error"
    );

    return;
  }


  await updateEmployee(
    employeeName,
    newRate,
    ""
  );
}


// =====================================================
// RESET EMPLOYEE PIN
// =====================================================

async function resetEmployeePin(
  employeeName
) {

  const newPin =
    prompt(
      "Enter a new 4-digit PIN for " +
      employeeName +
      ":"
    );


  if (newPin === null) {
    return;
  }


  if (
    !/^\d{4}$/.test(
      newPin.trim()
    )
  ) {

    setAdminStatus(
      "Error: PIN must be exactly 4 digits.",
      "error"
    );

    return;
  }


  await updateEmployee(
    employeeName,
    "",
    newPin.trim()
  );
}


// =====================================================
// UPDATE EMPLOYEE
// =====================================================

async function updateEmployee(
  employeeName,
  hourlyRate,
  employeePin
) {

  setAdminStatus(
    "Updating employee...",
    "processing"
  );


  try {

    const response =
      await fetch(url, {

        method: "POST",

        body: JSON.stringify({

          action:
            "Update Employee",

          adminPin:
            ADMIN_PIN,

          employeeName:
            employeeName,

          hourlyRate:
            hourlyRate,

          employeePin:
            employeePin

        })

      });


    const message =
      await response.text();


    if (
      message.startsWith("Success")
    ) {

      setAdminStatus(
        message,
        "success"
      );


      loadAdminDashboard();


    } else {

      setAdminStatus(
        message,
        "error"
      );

    }


  } catch (error) {

    console.error(error);


    setAdminStatus(
      "Error: Could not update employee.",
      "error"
    );

  }
}


// =====================================================
// DEACTIVATE EMPLOYEE
// =====================================================

async function deactivateEmployee(
  employeeName
) {

  const confirmed =
    confirm(
      "Remove " +
      employeeName +
      " from the active employee list?"
    );


  if (!confirmed) {
    return;
  }


  await changeEmployeeStatus(
    "Deactivate Employee",
    employeeName
  );
}


// =====================================================
// REACTIVATE EMPLOYEE
// =====================================================

async function reactivateEmployee(
  employeeName
) {

  await changeEmployeeStatus(
    "Reactivate Employee",
    employeeName
  );
}


// =====================================================
// CHANGE EMPLOYEE STATUS
// =====================================================

async function changeEmployeeStatus(
  action,
  employeeName
) {

  setAdminStatus(
    "Updating employee status...",
    "processing"
  );


  try {

    const response =
      await fetch(url, {

        method: "POST",

        body: JSON.stringify({

          action:
            action,

          adminPin:
            ADMIN_PIN,

          employeeName:
            employeeName

        })

      });


    const message =
      await response.text();


    if (
      message.startsWith("Success")
    ) {

      setAdminStatus(
        message,
        "success"
      );


      loadAdminDashboard();


    } else {

      setAdminStatus(
        message,
        "error"
      );

    }


  } catch (error) {

    console.error(error);


    setAdminStatus(
      "Error: Could not update employee status.",
      "error"
    );

  }
}


// =====================================================
// PAYROLL
// =====================================================

function renderPayroll(items) {

  const container =
    document.getElementById(
      "payrollSummary"
    );


  if (items.length === 0) {

    container.innerHTML =
      "No payroll data yet.";

    return;
  }


  container.innerHTML =
    items
      .map(item => `

        <div class="admin-row">

          <span>
            ${item.name}
          </span>

          <span>

            ${Number(
              item.hours || 0
            ).toFixed(2)} hrs

            /

            $${Number(
              item.pay || 0
            ).toFixed(2)}

          </span>

        </div>

      `)
      .join("");
}


// =====================================================
// ANALYTICS
// =====================================================

function renderAnalytics(data) {

  const container =
    document.getElementById(
      "analyticsBox"
    );


  container.innerHTML = `

    <div class="admin-row">

      <span>
        Total Active Employees
      </span>

      <span>
        ${data.totalEmployees || 0}
      </span>

    </div>


    <div class="admin-row">

      <span>
        Currently Clocked In
      </span>

      <span>
        ${data.activeCount || 0}
      </span>

    </div>


    <div class="admin-row">

      <span>
        Completed Shifts
      </span>

      <span>
        ${data.completedShifts || 0}
      </span>

    </div>


    <div class="admin-row">

      <span>
        Open Missed Requests
      </span>

      <span>
        ${data.pendingMissedRequests || 0}
      </span>

    </div>


    <div class="admin-row">

      <span>
        Total Projected Pay
      </span>

      <span>

        $${Number(
          data.totalProjectedPay || 0
        ).toFixed(2)}

      </span>

    </div>

  `;
}


// =====================================================
// MISSED PUNCHES
// =====================================================

function renderMissedPunches(items) {

  const container =
    document.getElementById(
      "missedPunchRequests"
    );


  if (items.length === 0) {

    container.innerHTML =
      "No missed punch requests.";

    return;
  }


  container.innerHTML =
    items
      .map(request => {

        const pending =
          String(
            request.status ||
            "Pending"
          )
            .toLowerCase() ===
          "pending";


        return `

          <div class="request-card">

            <strong>
              ${request.name}
            </strong>

            <br>

            ${request.type || ""}

            <br>

            ${request.requestedDate || ""}
            ${request.requestedTime || ""}

            <br>

            Status:
            <strong>
              ${request.status || "Pending"}
            </strong>


            ${
              pending

                ? `

                  <div class="request-actions">

                    <button
                      class="admin-approve"
                      onclick="updateMissedPunchStatus(
                        ${request.rowNumber},
                        'Approved'
                      )">

                      Approve

                    </button>


                    <button
                      class="admin-reject"
                      onclick="updateMissedPunchStatus(
                        ${request.rowNumber},
                        'Rejected'
                      )">

                      Reject

                    </button>

                  </div>

                `

                : ""
            }

          </div>

        `;

      })
      .join("");
}


// =====================================================
// UPDATE MISSED PUNCH
// =====================================================

async function updateMissedPunchStatus(
  rowNumber,
  status
) {

  setAdminStatus(
    "Updating request...",
    "processing"
  );


  try {

    const response =
      await fetch(url, {

        method: "POST",

        body: JSON.stringify({

          action:
            "Update Missed Punch Status",

          adminPin:
            ADMIN_PIN,

          rowNumber:
            rowNumber,

          status:
            status

        })

      });


    const message =
      await response.text();


    if (
      message.startsWith("Success")
    ) {

      setAdminStatus(
        message,
        "success"
      );


      loadAdminDashboard();


    } else {

      setAdminStatus(
        message,
        "error"
      );

    }


  } catch (error) {

    console.error(error);


    setAdminStatus(
      "Error: Could not update request.",
      "error"
    );

  }
}


// =====================================================
// RECENT PUNCHES
// =====================================================

function renderRecentPunches(items) {

  const container =
    document.getElementById(
      "recentPunches"
    );


  if (items.length === 0) {

    container.innerHTML =
      "No punches found.";

    return;
  }


  container.innerHTML =
    items
      .map(item => `

        <div class="admin-row">

          <span>

            <strong>
              ${item.name}
            </strong>

            <br>

            ${item.date || ""}

          </span>


          <span>

            ${item.clockIn || ""}

            →

            ${item.clockOut || "Open"}

          </span>

        </div>

      `)
      .join("");
}


// =====================================================
// SAFE NAME FOR ONCLICK
// =====================================================

function escapeQuotes(text) {

  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}
