const url = "https://script.google.com/macros/s/AKfycbwidHd1FgdRr3fUx2uqAAbBE3tUFGcFKOxqzN-lI7HT_-EFtaeVHMtRITl9faMdmyiDLA/exec";

const ADMIN_PIN = "9274";


// =====================================================
// STATUS
// =====================================================

function setAdminStatus(message, type) {

  const status =
    document.getElementById("status");

  if (!status) return;

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

    dashboard.style.display = "none";

    return;
  }


  setAdminStatus(
    "Admin Dashboard Unlocked.",
    "success"
  );


  loginPanel.style.display = "none";


  dashboard.style.display = "block";


  loadAdminDashboard();

}



// =====================================================
// LOAD DASHBOARD
// =====================================================

async function loadAdminDashboard() {


  setAdminStatus(
    "Refreshing dashboard...",
    "processing"
  );


  try {


    const response =
      await fetch(url, {

        method:"POST",

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
      text.startsWith("<!DOCTYPE html") ||
      text.startsWith("<html")
    ) {

      setAdminStatus(
        "Error: Backend returned invalid response.",
        "error"
      );

      return;

    }



    const data =
      JSON.parse(text);



    updateDashboardCards(data);



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



  } catch(error) {


    console.error(error);


    setAdminStatus(
      "Error: Could not load dashboard.",
      "error"
    );


  }

}



// =====================================================
// TOP SUMMARY CARDS
// =====================================================

function updateDashboardCards(data) {


  const stats =
    data.analytics || {};



  const clocked =
    document.getElementById(
      "clockedCount"
    );


  const employees =
    document.getElementById(
      "employeeCount"
    );


  const requests =
    document.getElementById(
      "requestCount"
    );


  const pay =
    document.getElementById(
      "projectedPay"
    );



  if(clocked){

    clocked.innerText =
      stats.activeCount || 0;

  }



  if(employees){

    employees.innerText =
      stats.totalEmployees || 0;

  }



  if(requests){

    requests.innerText =
      stats.pendingMissedRequests || 0;

  }



  if(pay){

    pay.innerText =
      "$" +
      Number(
        stats.totalProjectedPay || 0
      ).toFixed(2);

  }

}



// =====================================================
// CLOCKED IN LIST
// =====================================================

function renderClockedIn(employees){


const container =
document.getElementById(
"clockedInList"
);



if(!container) return;



if(employees.length===0){

container.innerHTML =
`
<div class="empty-state">
No employees currently clocked in.
</div>
`;

return;

}



container.innerHTML =

employees.map(employee=>{


return `

<div class="admin-row">

<div>

<strong>
${employee.name}
</strong>

<br>

<span>
Clocked in:
${employee.clockIn}
</span>

</div>


<span class="employee-active">
ACTIVE
</span>


</div>

`;

}).join("");

}// =====================================================
// ADD EMPLOYEE
// =====================================================

async function addEmployee(){


const employeeName =
document
.getElementById("newEmployeeName")
.value
.trim();



const hourlyRate =
document
.getElementById("newEmployeeRate")
.value
.trim();



const employeePin =
document
.getElementById("newEmployeePin")
.value
.trim();




if(employeeName===""){

setAdminStatus(
"Error: Enter an employee name.",
"error"
);

return;

}



if(
hourlyRate==="" ||
Number(hourlyRate)<0
){

setAdminStatus(
"Error: Enter a valid hourly rate.",
"error"
);

return;

}




if(!/^\d{4}$/.test(employeePin)){

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



try{


const response =
await fetch(url,{

method:"POST",

body:JSON.stringify({

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



if(message.startsWith("Success")){


setAdminStatus(
message,
"success"
);



document.getElementById(
"newEmployeeName"
).value="";



document.getElementById(
"newEmployeeRate"
).value="";



document.getElementById(
"newEmployeePin"
).value="";



loadAdminDashboard();



}
else{


setAdminStatus(
message,
"error"
);


}


}
catch(error){


console.error(error);


setAdminStatus(
"Error: Could not add employee.",
"error"
);


}


}




// =====================================================
// EMPLOYEE MANAGEMENT
// =====================================================

function renderEmployees(employees){


const container =
document.getElementById(
"employeeManagementList"
);



if(!container) return;



if(employees.length===0){


container.innerHTML =
"No employees found.";

return;

}




container.innerHTML =


employees.map(employee=>{



const status =
employee.active
?
"Active"
:
"Inactive";



const statusClass =
employee.active
?
"employee-active"
:
"employee-inactive";



const actionButton =

employee.active

?

`
<button
class="admin-reject"
onclick="deactivateEmployee('${escapeQuotes(employee.name)}')">

Remove

</button>
`

:

`

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


<span>

$${Number(
employee.rate || 0
).toFixed(2)}

/ hr

</span>



<br>



<span class="${statusClass}">

${status}

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





${actionButton}



</div>



</div>


`;



}).join("");



}





// =====================================================
// EDIT PAY
// =====================================================


async function editEmployeeRate(
employeeName,
currentRate
){



const newRate =
prompt(

"Enter new hourly rate for "
+
employeeName,

currentRate

);



if(newRate===null){

return;

}




if(
newRate.trim()==="" ||
isNaN(Number(newRate)) ||
Number(newRate)<0

){

setAdminStatus(
"Error: Invalid hourly rate.",
"error"
);

return;

}



updateEmployee(

employeeName,

newRate,

""

);



}





// =====================================================
// RESET PIN
// =====================================================


async function resetEmployeePin(
employeeName
){



const newPin =
prompt(

"Enter new 4-digit PIN for "
+
employeeName

);



if(newPin===null){

return;

}



if(!/^\d{4}$/.test(newPin.trim())){


setAdminStatus(
"Error: PIN must be exactly 4 digits.",
"error"
);


return;

}




updateEmployee(

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
){


setAdminStatus(
"Updating employee...",
"processing"
);



try{


const response =
await fetch(url,{

method:"POST",

body:JSON.stringify({

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



if(message.startsWith("Success")){


setAdminStatus(
message,
"success"
);



loadAdminDashboard();


}

else{


setAdminStatus(
message,
"error"
);


}



}

catch(error){


console.error(error);


setAdminStatus(
"Error: Could not update employee.",
"error"
);


}



}




// =====================================================
// REMOVE EMPLOYEE
// =====================================================


async function deactivateEmployee(
employeeName
){


const confirmRemove =
confirm(

"Remove "
+
employeeName
+
" from active employees?"

);



if(!confirmRemove){

return;

}



changeEmployeeStatus(
"Deactivate Employee",
employeeName
);



}




// =====================================================
// REACTIVATE EMPLOYEE
// =====================================================


async function reactivateEmployee(
employeeName
){


changeEmployeeStatus(
"Reactivate Employee",
employeeName
);


}





// =====================================================
// CHANGE STATUS
// =====================================================


async function changeEmployeeStatus(
action,
employeeName
){


setAdminStatus(
"Updating employee status...",
"processing"
);



try{


const response =
await fetch(url,{

method:"POST",

body:JSON.stringify({

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



if(message.startsWith("Success")){


setAdminStatus(
message,
"success"
);



loadAdminDashboard();



}

else{


setAdminStatus(
message,
"error"
);


}



}

catch(error){


console.error(error);


setAdminStatus(
"Error updating employee.",
"error"
);


}


}// =====================================================
// PAYROLL
// =====================================================

function renderPayroll(items){


const container =
document.getElementById(
"payrollSummary"
);



if(!container) return;



if(items.length===0){


container.innerHTML =
"No payroll data yet.";

return;

}




container.innerHTML =


items.map(item=>{


return `

<div class="admin-row">


<div>

<strong>
${item.name}
</strong>

</div>



<div>

${Number(
item.hours || 0
).toFixed(2)}
hrs

&nbsp;

|

&nbsp;

$${Number(
item.pay || 0
).toFixed(2)}

</div>


</div>

`;



}).join("");



}





// =====================================================
// ANALYTICS
// =====================================================

function renderAnalytics(data){


const container =
document.getElementById(
"analyticsBox"
);



if(!container) return;



container.innerHTML = `


<div class="admin-row">

<span>
Active Employees
</span>


<strong>
${data.totalEmployees || 0}
</strong>

</div>




<div class="admin-row">

<span>
Currently Clocked In
</span>


<strong>
${data.activeCount || 0}
</strong>

</div>




<div class="admin-row">

<span>
Completed Shifts
</span>


<strong>
${data.completedShifts || 0}
</strong>

</div>




<div class="admin-row">

<span>
Pending Requests
</span>


<strong>
${data.pendingMissedRequests || 0}
</strong>

</div>




<div class="admin-row">

<span>
Projected Payroll
</span>


<strong>

$${Number(
data.totalProjectedPay || 0
).toFixed(2)}

</strong>

</div>



`;



}





// =====================================================
// MISSED PUNCH REQUESTS
// =====================================================

function renderMissedPunches(items){


const container =
document.getElementById(
"missedPunchRequests"
);



if(!container) return;



if(items.length===0){


container.innerHTML =
"No missed punch requests.";

return;

}





container.innerHTML =


items.map(request=>{


const pending =

String(
request.status || "Pending"
)
.toLowerCase()
===
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

&nbsp;

${request.requestedTime || ""}



<br>


Status:

<strong>
${request.status || "Pending"}
</strong>



${

pending

?

`

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

:

""

}



</div>


`;



}).join("");



}







// =====================================================
// UPDATE MISSED PUNCH
// =====================================================

async function updateMissedPunchStatus(
rowNumber,
status
){



setAdminStatus(
"Updating request...",
"processing"
);



try{


const response =
await fetch(url,{

method:"POST",

body:JSON.stringify({

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



if(message.startsWith("Success")){


setAdminStatus(
message,
"success"
);



loadAdminDashboard();



}

else{


setAdminStatus(
message,
"error"
);


}



}

catch(error){


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

function renderRecentPunches(items){


const container =
document.getElementById(
"recentPunches"
);



if(!container) return;



if(items.length===0){


container.innerHTML =
"No recent punches.";

return;

}




container.innerHTML =


items.map(item=>{


return `


<div class="admin-row">


<div>


<strong>
${item.name}
</strong>


<br>


${item.date || ""}


</div>




<div>


${item.clockIn || ""}


&nbsp; → &nbsp;


${item.clockOut || "Open"}


<br>


${Number(
item.hours || 0
).toFixed(2)}
hrs


</div>



</div>


`;



}).join("");



}







// =====================================================
// ESCAPE QUOTES
// =====================================================

function escapeQuotes(text){


return String(text)

.replace(
/\\/g,
"\\\\"
)

.replace(
/'/g,
"\\'"
);


}
