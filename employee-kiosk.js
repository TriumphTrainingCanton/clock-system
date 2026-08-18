(function setupKioskIdleScreen() {
  "use strict";

  const parameters = new URLSearchParams(window.location.search);
  if (parameters.get("kiosk") !== "1") return;

  const IDLE_DELAY_MS = 30_000;
  const POINTER_THROTTLE_MS = 250;
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    weekday: "long",
    month: "long",
    day: "numeric"
  });

  let idleTimer = null;
  let clockTimer = null;
  let lastPointerActivity = 0;

  const screen = document.createElement("div");
  screen.id = "kioskIdleScreen";
  screen.className = "kiosk-idle-screen";
  screen.hidden = true;
  screen.setAttribute("aria-hidden", "true");
  screen.innerHTML = `
    <div class="kiosk-idle-glow" aria-hidden="true"></div>
    <section class="kiosk-idle-content">
      <img src="logo.png" class="kiosk-idle-logo" alt="">
      <p class="kiosk-idle-eyebrow">Triumph Training Center</p>
      <p id="kioskIdleTime" class="kiosk-idle-time">--:-- --</p>
      <p id="kioskIdleDate" class="kiosk-idle-date">Loading date…</p>
      <p class="kiosk-idle-prompt">Move the mouse or touch the screen to clock in</p>
    </section>
  `;
  document.body.appendChild(screen);
  document.documentElement.classList.add("kiosk-mode");

  const time = screen.querySelector("#kioskIdleTime");
  const date = screen.querySelector("#kioskIdleDate");

  function updateIdleClock() {
    const now = new Date();
    time.textContent = timeFormatter.format(now);
    date.textContent = dateFormatter.format(now);
  }

  function stopIdleClock() {
    if (clockTimer !== null) window.clearInterval(clockTimer);
    clockTimer = null;
  }

  function showIdleScreen() {
    updateIdleClock();
    screen.hidden = false;
    document.documentElement.classList.add("kiosk-is-idle");
    stopIdleClock();
    clockTimer = window.setInterval(updateIdleClock, 1_000);
  }

  function hideIdleScreen() {
    if (screen.hidden) return;
    screen.hidden = true;
    document.documentElement.classList.remove("kiosk-is-idle");
    stopIdleClock();
  }

  function scheduleIdleScreen() {
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(showIdleScreen, IDLE_DELAY_MS);
  }

  function registerActivity(event) {
    if (event.type === "pointermove") {
      const now = Date.now();
      if (now - lastPointerActivity < POINTER_THROTTLE_MS) return;
      lastPointerActivity = now;
    }

    hideIdleScreen();
    scheduleIdleScreen();
  }

  ["pointerdown", "pointermove", "touchstart", "keydown", "wheel"].forEach(eventName => {
    window.addEventListener(eventName, registerActivity, { passive: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      stopIdleClock();
      return;
    }

    hideIdleScreen();
    scheduleIdleScreen();
  });

  scheduleIdleScreen();
})();
