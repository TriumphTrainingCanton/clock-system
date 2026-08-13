// Loads admin insights after the core dashboard is ready.
// This keeps Employee Details, Activity Log, payroll filters, and missed-punch history
// out of the normal dashboard payload unless the admin asks for them.

(function () {
  if (document.getElementById("adminInsightsScript")) return;

  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "admin-insights.css?v=2";
  document.head.appendChild(css);

  const finalCss = document.createElement("link");
  finalCss.rel = "stylesheet";
  finalCss.href = "admin-final-features.css?v=2";
  document.head.appendChild(finalCss);

  const headerActions = document.querySelector(".dashboard-header-actions");
  if (headerActions && !document.getElementById("systemHealthBadge")) {
    const health = document.createElement("div");
    health.className = "system-health-wrap";
    health.setAttribute("role", "status");
    health.setAttribute("aria-live", "polite");
    health.innerHTML = `
      <span id="systemHealthBadge" class="system-health-badge">Checking backend</span>
      <span id="systemHealthDetail" class="system-health-detail">Waiting for dashboard response</span>
    `;
    headerActions.prepend(health);
  }

  const dashboardGrid = document.querySelector(".dashboard-grid");
  if (dashboardGrid && !document.getElementById("adminActivityLogSection")) {
    const section = document.createElement("section");
    section.id = "adminActivityLogSection";
    section.className = "admin-section full-width";
    section.setAttribute("aria-labelledby", "adminActivityLogHeading");
    section.innerHTML = `
      <div class="activity-toolbar">
        <div>
          <h2 id="adminActivityLogHeading">Admin Activity Log</h2>
          <p>Recent management changes. Loaded only when you ask for it.</p>
        </div>
        <button id="loadActivityButton" type="button" class="admin-small-button secondary" onclick="loadAdminActivityLog()">
          Load Activity
        </button>
      </div>
      <div id="adminActivityLog" class="empty-state">Activity history is not loaded during normal dashboard refreshes.</div>
    `;
    dashboardGrid.appendChild(section);
  }

  const script = document.createElement("script");
  script.id = "adminInsightsScript";
  script.src = "admin-insights.js?v=2";
  script.onload = () => {
    if (document.getElementById("adminFinalFeaturesScript")) return;

    const finalScript = document.createElement("script");
    finalScript.id = "adminFinalFeaturesScript";
    finalScript.src = "admin-final-features.js?v=3";
    finalScript.onload = () => {
      if (document.getElementById("adminPolishScript")) return;
      const polishScript = document.createElement("script");
      polishScript.id = "adminPolishScript";
      polishScript.src = "admin-polish.js?v=4";
      document.body.appendChild(polishScript);
    };
    document.body.appendChild(finalScript);
  };
  document.body.appendChild(script);
})();
