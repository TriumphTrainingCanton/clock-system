const url = "https://script.google.com/macros/s/AKfycbwidHd1FgdRr3fUx2uqAAbBE3tUFGcFKOxqzN-lI7HT_-EFtaeVHMtRITl9faMdmyiDLA/exec";

let cachedIP = "Unable to Detect";
let ipLoaded = false;

async function loadPublicIP() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const response = await fetch("https://api.ipify.org?format=json", {
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error("IP service returned " + response.status);
    }

    const data = await response.json();
    if (data.ip) cachedIP = data.ip;
  } catch (error) {
    console.error("Could not get IP address:", error);
    cachedIP = "Unable to Detect";
  } finally {
    ipLoaded = true;
  }
}

loadPublicIP();

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

  buttons.forEach(button => button.disabled = true);
  setStatus("Processing...", "processing");

  if (!ipLoaded) {
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        name,
        pin,
        action,
        ipAddress: cachedIP
      })
    });

    const message = await response.text();

    if (message.trim().startsWith("<!DOCTYPE html") || message.trim().startsWith("<html")) {
      console.error("Unexpected HTML response:", message);
      setStatus("Error: Backend deployment URL is not responding correctly.", "error");
      return;
    }

    if (message.startsWith("Success")) {
      setStatus(message, "success");
      document.getElementById("pin").value = "";
    } else {
      setStatus(message, "error");
    }
  } catch (error) {
    console.error("Clock request failed:", error);
    setStatus("Error: Could not connect. Try again.", "error");
  } finally {
    buttons.forEach(button => button.disabled = false);
  }
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

function clockIn() { send("Clock In"); }
function clockOut() { send("Clock Out"); }
function missedClockOut() { send("Missed Clock Out"); }
