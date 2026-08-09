const url = "https://script.google.com/macros/s/AKfycbwidHd1FgdRr3fUx2uqAAbBE3tUFGcFKOxqzN-lI7HT_-EFtaeVHMtRITl9faMdmyiDLA/exec";

let cachedIP = "Unable to Detect";
let ipLoaded = false;


// ==============================
// LOAD PUBLIC IP
// ==============================

async function loadPublicIP() {
  try {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 2500);

    const response = await fetch(
      "https://api.ipify.org?format=json",
      {
        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(
        "IP service returned " + response.status
      );
    }

    const data = await response.json();

    if (data.ip) {
      cachedIP = data.ip;
    }

  } catch (error) {
    console.error(
      "Could not get IP address:",
      error
    );

    cachedIP = "Unable to Detect";

  } finally {
    ipLoaded = true;
  }
}

loadPublicIP();


// ==============================
// LOAD EMPLOYEES FROM SHEET
// ==============================

async function loadEmployees() {
  const select =
    document.getElementById("name");

  try {
    const response = await fetch(url, {
      method: "POST",

      body: JSON.stringify({
        action: "Get Employees"
      })
    });

    const text =
      await response.text();


    // Catch broken Apps Script deployment pages
    if (
      text.trim().startsWith("<!DOCTYPE html") ||
      text.trim().startsWith("<html")
    ) {
      throw new Error(
        "Backend returned HTML instead of employee data."
      );
    }


    const employees =
      JSON.parse(text);


    select.innerHTML =
      '<option value="">Select Employee</option>';


    employees.forEach(employee => {
      const option =
        document.createElement("option");

      option.value =
        employee.name;

      option.textContent =
        employee.name;

      select.appendChild(option);
    });


    if (employees.length === 0) {
      select.innerHTML =
        '<option value="">No active employees</option>';
    }

  } catch (error) {
    console.error(
      "Could not load employees:",
      error
    );

    select.innerHTML =
      '<option value="">Error loading employees</option>';
  }
}

loadEmployees();


// ==============================
// STATUS MESSAGE
// ==============================

function setStatus(message, type) {
  const status =
    document.getElementById("status");

  status.className = type;
  status.innerText = message;
}


// ==============================
// SEND CLOCK REQUEST
// ==============================

async function send(action) {

  const name =
    document
      .getElementById("name")
      .value
      .trim();


  const pin =
    document
      .getElementById("pin")
      .value
      .trim();


  const buttons =
    document.querySelectorAll("button");


  if (name === "") {
    setStatus(
      "Error: Please select your name.",
      "error"
    );

    return;
  }


  if (pin === "") {
    setStatus(
      "Error: Please enter your PIN.",
      "error"
    );

    return;
  }


  buttons.forEach(button => {
    button.disabled = true;
  });


  setStatus(
    "Processing...",
    "processing"
  );


  // Give IP lookup a brief moment to finish
  if (!ipLoaded) {
    await new Promise(resolve =>
      setTimeout(resolve, 300)
    );
  }


  try {

    const response =
      await fetch(url, {

        method: "POST",

        body: JSON.stringify({
          name: name,
          pin: pin,
          action: action,
          ipAddress: cachedIP
        })

      });


    const message =
      await response.text();


    // Prevent giant Google HTML error page
    if (
      message.trim().startsWith("<!DOCTYPE html") ||
      message.trim().startsWith("<html")
    ) {

      console.error(
        "Unexpected HTML response:",
        message
      );


      setStatus(
        "Error: Backend deployment URL is not responding correctly.",
        "error"
      );

      return;
    }


    if (
      message.startsWith("Success")
    ) {

      setStatus(
        message,
        "success"
      );


      document
        .getElementById("pin")
        .value = "";

    } else {

      setStatus(
        message,
        "error"
      );
    }


  } catch (error) {

    console.error(
      "Clock request failed:",
      error
    );


    setStatus(
      "Error: Could not connect. Try again.",
      "error"
    );

  } finally {

    buttons.forEach(button => {
      button.disabled = false;
    });

  }
}


// ==============================
// LIVE CLOCK
// ==============================

function updateClock() {

  const now =
    new Date();


  document
    .getElementById("liveTime")
    .innerText =

    now.toLocaleTimeString([], {

      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true

    });


  document
    .getElementById("liveDate")
    .innerText =

    now.toLocaleDateString([], {

      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"

    });

}


setInterval(
  updateClock,
  1000
);


updateClock();


// ==============================
// BUTTON FUNCTIONS
// ==============================

function clockIn() {
  send("Clock In");
}


function clockOut() {
  send("Clock Out");
}


function missedClockOut() {
  send("Missed Clock Out");
}
