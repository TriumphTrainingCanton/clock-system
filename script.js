const IS_LEGACY_PAGES = window.location.hostname === "clock-system.pages.dev";
const LEGACY_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwidHd1FgdRr3fUx2uqAAbBE3tUFGcFKOxqzN-lI7HT_-EFtaeVHMtRITl9faMdmyiDLA/exec";
const url = IS_LEGACY_PAGES ? LEGACY_APPS_SCRIPT_URL : "/api";

const EMPLOYEE_CACHE_KEY = "triumph_employee_list_v1";
const EMPLOYEE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const SUCCESS_RESET_DELAY_MS = 1200;

let cachedIP = "Unable to Detect";
let punchInFlight = false;
let portalReady = false;
let resetTimer = null;

function fetchWithTimeout(requestUrl, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(requestUrl, {
    ...options,
    signal: controller.signal,
    cache: "no-store"
  }).finally(() => clearTimeout(timeout));
}

function setPortalReady(ready, label) {
  portalReady = Boolean(ready);
  const pill = document.getElementById("portalReadyPill");
  const text = document.getElementById("portalReadyText");

  if (!pill || !text) return;

  pill.classList.toggle("ready", portalReady && navigator.onLine);
  text.textContent = label || (portalReady ? "Ready" : "Connecting");
}

function updateOnlineState() {
  if (!navigator.onLine) {
    setPortalReady(false, "Offline");
    if (!punchInFlight) {
      setStatus("No network connection. Reconnect before clocking in or out.", "error");
    }
    return;
  }

  setPortalReady(portalReady, portalReady ? "Ready" : "Connecting");
}

window.addEventListener("online", updateOnlineState);
window.addEventListener("offline", updateOnlineState);

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

// Do not compete with first paint or employee-list rendering.
if ("requestIdleCallback" in window) {
  requestIdleCallback(loadPublicIP, { timeout: 1800 });
} else {
  setTimeout(loadPublicIP, 250);
}

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

  setPortalReady(employees.length > 0, employees.length > 0 ? "Ready" : "No staff");
}

async function loadEmployees() {
  const select = document.getElementById("name");
  const cachedEmployees = readEmployeeCache();

  if (cachedEmployees) {
    renderEmployees(cachedEmployees);
  } else {
    setPortalReady(false, "Connecting");
  }

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      ...(IS_LEGACY_PAGES ? {} : {
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin"
      }),
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
      setPortalReady(false, "Unavailable");
      setStatus("Could not load employees. Refresh and try again.", "error");
    }
  }
}

// ==============================
// STATUS + UI STATE
// ==============================

function statusSymbolFor(type) {
  if (type === "success") return "✓";
  if (type === "error") return "!";
  if (type === "processing") return "";
  return "•";
}

function statusLabelFor(type) {
  if (type === "success") return "Completed";
  if (type === "error") return "Needs attention";
  if (type === "processing") return "Working";
  return "Status";
}

function setStatus(message, type = "") {
  const status = document.getElementById("status");
  const card = document.getElementById("employeeStatusCard");
  const icon = document.getElementById("employeeStatusSymbol");
  const label = document.getElementById("employeeStatusLabel");

  status.className = "";
  status.innerText = message;

  if (card) {
    card.classList.remove("success", "error", "processing");
    if (type) card.classList.add(type);
  }

  if (icon) icon.textContent = statusSymbolFor(type);
  if (label) label.textContent = statusLabelFor(type);
}

function setPunchControlsDisabled(disabled, activeAction = "") {
  const buttons = document.querySelectorAll("[data-punch-action]");

  buttons.forEach(button => {
    button.disabled = disabled;

    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.querySelector(".employee-button-label")?.textContent || button.textContent.trim();
    }

    const label = button.querySelector(".employee-button-label");
    if (!label) return;

    const action = button.dataset.action;
    if (disabled && action === activeAction) {
      label.textContent = action === "Clock In"
        ? "Clocking In…"
        : action === "Clock Out"
          ? "Clocking Out…"
          : "Submitting…";
    } else {
      label.textContent = button.dataset.defaultLabel;
    }
  });

  document.getElementById("name").disabled = disabled;
  document.getElementById("pin").disabled = disabled;
}

function resetEmployeeForm() {
  const select = document.getElementById("name");
  const pin = document.getElementById("pin");

  select.value = "";
  pin.value = "";
  select.focus();
}

function scheduleSuccessfulReset() {
  clearTimeout(resetTimer);
  resetTimer = setTimeout(resetEmployeeForm, SUCCESS_RESET_DELAY_MS);
}

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// ==============================
// SEND CLOCK REQUEST
// ==============================

async function send(action) {
  if (punchInFlight) return;

  const nameSelect = document.getElementById("name");
  const pinInput = document.getElementById("pin");
  const name = nameSelect.value.trim();
  const pin = pinInput.value.trim();

  clearTimeout(resetTimer);

  if (!navigator.onLine) {
    setStatus("You are offline. Reconnect before submitting a punch.", "error");
    vibrate(80);
    return;
  }

  if (name === "") {
    setStatus("Select your name before continuing.", "error");
    nameSelect.focus();
    vibrate(80);
    return;
  }

  if (!/^\d{4}$/.test(pin)) {
    setStatus("Enter your 4-digit PIN before continuing.", "error");
    pinInput.focus();
    vibrate(80);
    return;
  }

  punchInFlight = true;
  setPunchControlsDisabled(true, action);

  const actionLabel = action === "Clock In"
    ? `Clocking in ${name}…`
    : action === "Clock Out"
      ? `Clocking out ${name}…`
      : `Submitting missed clock-out request for ${name}…`;

  setStatus(actionLabel, "processing");

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
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
      const friendlyMessage = action === "Clock In"
        ? `${name} is clocked in successfully.`
        : action === "Clock Out"
          ? `${name} is clocked out successfully.`
          : `Missed clock-out request submitted for ${name}.`;

      setStatus(friendlyMessage, "success");
      pinInput.value = "";
      vibrate([45, 55, 45]);
      scheduleSuccessfulReset();
    } else {
      setStatus(message.replace(/^Error:\s*/i, "") || "Unable to complete request.", "error");
      vibrate(100);
    }
  } catch (error) {
    console.error("Clock request failed:", error);

    const timedOut = error && error.name === "AbortError";
    setStatus(
      timedOut
        ? "The clock system took too long to respond. Nothing was retried automatically — try once more."
        : "Could not reach the clock system. Please try again.",
      "error"
    );
    vibrate(100);
  } finally {
    punchInFlight = false;
    setPunchControlsDisabled(false);

    if (!document.getElementById("name").value) {
      document.getElementById("name").focus();
    } else {
      pinInput.focus();
    }
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

let clockTimer = null;

function startClock() {
  if (clockTimer) clearInterval(clockTimer);
  updateClock();
  clockTimer = setInterval(updateClock, 1000);
}

function stopClock() {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopClock();
  else startClock();
});

// ==============================
// INPUT / KIOSK ERGONOMICS
// ==============================

function setupEmployeeInputs() {
  const select = document.getElementById("name");
  const pin = document.getElementById("pin");

  select.addEventListener("change", () => {
    if (select.value) {
      setStatus(`Ready for ${select.value}. Enter PIN and choose an action.`, "");
      pin.focus();
    }
  });

  pin.addEventListener("input", () => {
    const digitsOnly = pin.value.replace(/\D/g, "").slice(0, 4);
    if (pin.value !== digitsOnly) pin.value = digitsOnly;
  });

  pin.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      resetEmployeeForm();
      setStatus("Selection cleared.", "");
    }
  });
}

// ==============================
// STARTUP
// ==============================

setStatus("Select your name to begin.", "");
setupEmployeeInputs();
startClock();
updateOnlineState();
loadEmployees();

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
