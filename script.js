const url = "https://script.google.com/macros/s/AKfycbyQL6m6KbI3by8pzWayyvf4CA_zDnmAqJRwG9wZkcQWkJcPFZOMfC7IYyG1U4Rdye6SXA/exec";

const pins = {
  "Madelyn": "4827",
  "Sandy": "6159",
  "John": "2048",
  "Carissa": "7731",
  "Kendra": "9184",
  "Phillip": "3562",
  "Ananth": "6407",
  "Hitesh": "1275",
  "Meng": "8843",
  "Kai": "5316"
};

function setStatus(message, type) {
  const status = document.getElementById("status");
  status.className = type;
  status.innerText = message;
}

function send(action) {
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

  if (pins[name] !== pin) {
    setStatus("Error: Incorrect PIN.", "error");
    return;
  }

  buttons.forEach(button => {
    button.disabled = true;
  });

  setStatus("Processing...", "processing");

  fetch(url, {
    method: "POST",
    body: JSON.stringify({
      name: name,
      pin: pin,
      action: action
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