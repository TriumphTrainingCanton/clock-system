const url = "https://script.google.com/macros/s/AKfycbwidHd1FgdRr3fUx2uqAAbBE3tUFGcFKOxqzN-lI7HT_-EFtaeVHMtRITl9faMdmyiDLA/exec";

async function getPublicIP() {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();
    return data.ip;
  } catch (error) {
    console.error("Could not get IP address:", error);
    return "Unable to Detect";
  }
}

function setStatus(message, type) {
  const status = document.getElementById("status");
  status.className = type;
  status.innerText = message;
}

async function send(action) {
  const name = document.getElementById("name").value.trim();
  const pin = document.getElementById("pin").value.trim();
  const buttons = document.querySelectorAll("button");

  if (name === "") {
    setStatus("Error: Please select your name.", "error");
    return;
  }

  if (pin === "") {
    setStatus("Error: Please enter your PIN.", "error");
    return;
  }

  buttons.forEach(button => {
    button.disabled = true;
  });

  setStatus("Processing...", "processing");

  const ipAddress = await getPublicIP();

  fetch(url, {
    method: "POST",
    body: JSON.stringify({
      name: name,
      pin: pin,
      action: action,
      ipAddress: ipAddress
    })
  })

  .then(res => res.text())

  .then(message => {
    if (message.startsWith("Success")) {
      setStatus(message, "success");
      document.getElementById("pin").value = "";
    } else {
      setStatus(message, "error");
    }
  })

  .catch(error => {
    setStatus("Error: Could not connect. Try again.", "error");
  })

  .finally(() => {
    buttons.forEach(button => {
      button.disabled = false;
    });
  });
}

function updateClock() {
  const now = new Date();

  document.getElementById("liveTime").innerText =
    now.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });

  document.getElementById("liveDate").innerText =
    now.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
}

setInterval(updateClock, 1000);

updateClock();

function clockIn() {
  send("Clock In");
}

function clockOut() {
  send("Clock Out");
}

function missedClockOut() {
  send("Missed Clock Out");
}