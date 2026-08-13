const url = "https://script.google.com/macros/s/AKfycbwidHd1FgdRr3fUx2uqAAbBE3tUFGcFKOxqzN-lI7HT_-EFtaeVHMtRITl9faMdmyiDLA/exec";

const EMPLOYEE_CACHE_KEY = "triumph_employee_list_v1";
const EMPLOYEE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;

let cachedIP = "Unable to Detect";
let punchInFlight = false;

function fetchWithTimeout(requestUrl, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(requestUrl, {
    ...options,
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
}

// ==============================
// LOAD PUBLIC IP IN BACKGROUND
// ==============================

async function loadPublicIP() {
  try {
    const response = await fetchWithTimeout(
      "https://api.ipify.org?format=json",
      {},
      2500
    );

    if (!response.ok) {
      throw new Error("IP service returned " + response.status);
    }

    const data = await response.json();
    if (data.ip) cachedIP = data.ip;
  } catch (error) {
    console.warn("Could not get IP address; continuing without it.", error);
    cachedIP = "Unable to Detect";
  }
}

loadPublicIP();

// ==============================
// EMPLOYEE LIST CACHE
// ==============================

function readEmployeeCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(EMPLOYEE_CACHE_KEY) || "null");
    if (!cached || !Array.isArray(cached.employees) || !cached.savedAt) return null;

    const age = Date.now() - Number(cached.savedAt);
    if (!Number.isFinite(age) || age < 0 || age > EMPLOYEE_CACHE_MAX_AGE_MS) {
      localStorage.removeItem(EMPLOYEE_CACHE_KEY);
      return null;
    }

    return cached.employees;
  } catch (error) {
    return null;
  }
}

function saveEmployeeCache(employees) {
  try {
    localStorage.setItem(
      EMPLOYEE_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), employees })
    );
  } catch (error) {
    console.warn("Could not cache employee list.", error);
  }
}

function renderEmployees(employees) {
  const select = document.getElementById("name");
  const previousValue = select.value;

  select.innerHTML = '<option value="">Select Employee</option>';

  employees.forEach(employee => {
    if (!employee || !employee.name) return;

    const option = document.createElement("option");
    option.value = employee.name;
    option.textContent = employee.name;
    select.appendChild(option);
  });

  if (employees.length === 0) {
    select.innerHTML = '<option value="">No active employees</option>';
  } else if (previousValue && employees.some(employee => employee.name === previousValue)) {
    select.value = previousValue;
  }
}

async function loadEmployees() {
  const select = document.getElementById("name");
  const cachedEmployees = readEmployeeCache();

  if (cachedEmployees) {
    renderEmployees(cachedEmployees);
  }

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      body: JSON.stringify({ action: "Get Employees" })
    }, 8000);

    if (!response.ok) {
      throw new Error("Employee request returned " + response.status);
    }

    const text = await response.text();
    const trimmed = text.trim();

    if (trimmed.startsWith("<!DOCTYPE html") || trimmed.startsWith("<html")) {
      throw new Error("Backend returned HTML instead of employee data.");
    }

    const employees = JSON.parse(trimmed);
    if (!Array.isArray(employees)) {
      throw new Error("Employee response was not a list.");
    }

    saveEmployeeCache(employees);
    renderEmployees(employees);
  } catch (error) {
    console.error("Could not refresh employees:", error);

    if (!cachedEmployees) {
      select.innerHTML = '<option value="">Error loading employees</option>';
      setStatus("Could not load employees. Please refresh and try again.", "error");
    }
  }
}

loadEmployees();

// ==============================
// STATUS MESSAGE
// ==============================

function setStatus(message, type) {
  const status = document.getElementById("status");
  status.className = type || "";
  status.innerText = message;
}

function setPunchControlsDisabled(disabled) {
  document.querySelectorAll("[data-punch-action]").forEach(button => {
    button.disabled = disabled;
  });

  document.getElementById("name").disabled = disabled;
  document.getElementById("pin").disabled = disabled;
}

// ==============================
// SEND CLOCK REQUEST
// ==============================

async function send(action) {
  if (punchInFlight) return;

  const name = document.getElementById("name").value.trim();
  const pinInput = document.getElementById("pin");
  const pin = pinInput.value.trim();

  if (name === "") {
    setStatus("Please select your name.", "error");
    document.getElementById("name").focus();
    return;
  }

  if (!/^\d{4}$/.test(pin)) {
    setStatus("Please enter your 4-digit PIN.", "error");
    pinInput.focus();
    return;
  }

  punchInFlight = true;
  setPunchControlsDisabled(true);

  const actionLabel = action === "Clock In"
    ? "Clocking in..."
    : action === "Clock Out"
      ? "Clocking out..."
      : "Submitting request...";

  setStatus(actionLabel, "processing");

  try {
    // IP lookup is intentionally non-blocking. Use whatever value is ready now.
    const response = await fetchWithTimeout(url, {
      method: "POST",
      body: JSON.stringify({
        name,
        pin,
        action,
        ipAddress: cachedIP
      })
    });

    if (!response.ok) {
      throw new Error("Server returned " + response.status);
    }

    const message = (await response.text()).trim();

    if (message.startsWith("<!DOCTYPE html") || message.startsWith("<html")) {
      throw new Error("Backend deployment is not responding correctly.");
    }

    if (message.startsWith("Success")) {
      setStatus(message, "success");
      pinInput.value = "";
    } else {
      setStatus(message || "Unable to complete request.", "error");
    }
  } catch (error) {
    console.error("Clock request failed:", error);

    const timedOut = error && error.name === "AbortError";
    setStatus(
      timedOut
        ? "Request took too long. Please try again."
        : "Could not connect. Please try again.",
      "error"
    );
  } finally {
    punchInFlight = false;
    setPunchControlsDisabled(false);
    pinInput.focus();
  }
}

// ==============================
// LIVE CLOCK
// ==============================

function updateClock() {
  const now = new Date();

  document.getElementById("liveTime").innerText = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });

  document.getElementById("liveDate").innerText = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

setInterval(updateClock, 1000);
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
