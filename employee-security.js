// Triumph Training employee workflow + abuse-prevention layer.
// Loaded after script.js so the proven core clock UI stays isolated and fast.

const TRIUMPH_PENDING_REQUEST_KEY = "triumph_employee_pending_request_v1";
const TRIUMPH_PENDING_REQUEST_MAX_AGE_MS = 2 * 60 * 1000;

function triumphCreateRequestId() {
  const cryptoObject = window.crypto || window.msCrypto;
  if (!cryptoObject || typeof cryptoObject.getRandomValues !== "function") {
    throw new Error("This browser cannot safely create a request ID. Please update the browser.");
  }

  if (typeof cryptoObject.randomUUID === "function") {
    return cryptoObject.randomUUID().replace(/-/g, "_");
  }

  const randomBytes = new Uint8Array(16);
  cryptoObject.getRandomValues(randomBytes);
  randomBytes[6] = (randomBytes[6] & 15) | 64;
  randomBytes[8] = (randomBytes[8] & 63) | 128;

  const hex = [];
  for (let index = 0; index < randomBytes.length; index += 1) {
    hex.push((randomBytes[index] + 256).toString(16).slice(1));
  }

  return "triumph_" + hex.join("");
}

function triumphReadPendingRequest() {
  try {
    const pending = JSON.parse(sessionStorage.getItem(TRIUMPH_PENDING_REQUEST_KEY) || "null");
    if (!pending || !pending.requestId || !pending.savedAt) return null;

    if (Date.now() - Number(pending.savedAt) > TRIUMPH_PENDING_REQUEST_MAX_AGE_MS) {
      sessionStorage.removeItem(TRIUMPH_PENDING_REQUEST_KEY);
      return null;
    }

    return pending;
  } catch (error) {
    return null;
  }
}

function triumphGetRequestId(name, action, extra) {
  const fingerprint = JSON.stringify({ name, action, extra: extra || {} });
  const pending = triumphReadPendingRequest();
  if (pending && pending.fingerprint === fingerprint) return pending.requestId;

  const requestId = triumphCreateRequestId();
  try {
    sessionStorage.setItem(
      TRIUMPH_PENDING_REQUEST_KEY,
      JSON.stringify({ requestId, fingerprint, savedAt: Date.now() })
    );
  } catch (error) {
    console.warn("Could not persist request id.", error);
  }

  return requestId;
}

function triumphClearPendingRequest(requestId) {
  try {
    const pending = triumphReadPendingRequest();
    if (!pending || pending.requestId === requestId) {
      sessionStorage.removeItem(TRIUMPH_PENDING_REQUEST_KEY);
    }
  } catch (error) {
    console.warn("Could not clear pending request id.", error);
  }
}

function triumphValidateCredentials() {
  const nameSelect = document.getElementById("name");
  const pinInput = document.getElementById("pin");
  const name = nameSelect.value.trim();
  const pin = pinInput.value.trim();

  if (!navigator.onLine) {
    setStatus("You are offline. Reconnect before submitting a punch.", "error");
    vibrate(80);
    return null;
  }

  if (!name) {
    setStatus("Select your name before continuing.", "error");
    nameSelect.focus();
    vibrate(80);
    return null;
  }

  if (!/^\d{4}$/.test(pin)) {
    setStatus("Enter your 4-digit PIN before continuing.", "error");
    pinInput.focus();
    vibrate(80);
    return null;
  }

  return { name, pin };
}

send = async function (action, extra = {}) {
  if (punchInFlight) return false;

  const credentials = triumphValidateCredentials();
  if (!credentials) return false;

  const { name, pin } = credentials;
  const pinInput = document.getElementById("pin");
  clearTimeout(resetTimer);

  const requestId = triumphGetRequestId(name, action, extra);
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
        ipAddress: cachedIP,
        requestId,
        ...extra
      })
    });

    if (!response.ok) throw new Error("Server returned " + response.status);

    const message = (await response.text()).trim();
    if (message.startsWith("<!DOCTYPE html") || message.startsWith("<html")) {
      throw new Error("Backend deployment is not responding correctly.");
    }

    triumphClearPendingRequest(requestId);

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
      return true;
    }

    setStatus(message.replace(/^Error:\s*/i, "") || "Unable to complete request.", "error");
    vibrate(100);
    return false;
  } catch (error) {
    console.error("Clock request failed:", error);

    const timedOut = error && error.name === "AbortError";
    setStatus(
      timedOut
        ? "The clock system took too long to respond. Tap the same action again — duplicate protection is active."
        : "Could not reach the clock system. Please try again.",
      "error"
    );
    vibrate(100);
    return false;
  } finally {
    punchInFlight = false;
    setPunchControlsDisabled(false);

    const modal = document.getElementById("missedPunchModal");
    if (!document.getElementById("name").value) {
      document.getElementById("name").focus();
    } else if (!modal || !modal.classList.contains("open")) {
      pinInput.focus();
    }
  }
};

function triumphLocalDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function triumphLocalTimeValue(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function openMissedPunchModal() {
  const credentials = triumphValidateCredentials();
  if (!credentials) return;

  const modal = document.getElementById("missedPunchModal");
  const employeeText = document.getElementById("missedEmployeeName");
  const dateInput = document.getElementById("missedDate");
  const timeInput = document.getElementById("missedTime");
  const reasonInput = document.getElementById("missedReason");
  const today = triumphLocalDateValue();

  employeeText.textContent = credentials.name;
  dateInput.value = today;
  dateInput.max = today;
  timeInput.value = triumphLocalTimeValue();
  reasonInput.value = "";

  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add("open"));
  document.body.classList.add("employee-modal-open");
  setTimeout(() => dateInput.focus(), 40);
}

function closeMissedPunchModal() {
  const modal = document.getElementById("missedPunchModal");
  if (!modal || modal.hidden) return;

  modal.classList.remove("open");
  document.body.classList.remove("employee-modal-open");
  setTimeout(() => {
    if (!modal.classList.contains("open")) modal.hidden = true;
  }, 140);
}

async function submitMissedPunch() {
  const dateInput = document.getElementById("missedDate");
  const timeInput = document.getElementById("missedTime");
  const reasonInput = document.getElementById("missedReason");
  const date = dateInput.value;
  const time = timeInput.value;
  const reason = reasonInput.value.trim().replace(/\s+/g, " ");

  if (!date) {
    setStatus("Choose the date of the missed clock out.", "error");
    dateInput.focus();
    return;
  }

  if (!time) {
    setStatus("Choose the approximate clock-out time.", "error");
    timeInput.focus();
    return;
  }

  if (reason.length < 5 || reason.length > 200) {
    setStatus("Enter a short reason between 5 and 200 characters.", "error");
    reasonInput.focus();
    return;
  }

  const submitButton = document.getElementById("missedSubmitButton");
  submitButton.disabled = true;

  try {
    const success = await send("Submit Missed Punch", {
      requestedDate: date,
      requestedTime: time,
      reason
    });

    if (success) closeMissedPunchModal();
  } finally {
    submitButton.disabled = false;
  }
}

missedClockOut = function () {
  openMissedPunchModal();
};

const triumphMissedModal = document.getElementById("missedPunchModal");
if (triumphMissedModal) {
  triumphMissedModal.addEventListener("click", event => {
    if (event.target === triumphMissedModal) closeMissedPunchModal();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && triumphMissedModal.classList.contains("open")) {
      closeMissedPunchModal();
    }
  });
}
