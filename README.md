# Triumph Training Clock System

Employee clock-in/clock-out and admin dashboard for Triumph Training.

## Official deployment

- Employee portal: https://clock-system.triumphtrainingcanton.workers.dev/\n- Raspberry Pi kiosk mode: https://clock-system.triumphtrainingcanton.workers.dev/?kiosk=1 (30-second branded idle screen)
- Admin dashboard: https://clock-system.triumphtrainingcanton.workers.dev/admin
- Legacy rollback only: https://clock-system.pages.dev/

Daily punches use the Cloudflare Worker and Neon backend. The legacy Pages deployment remains available only for rollback and continues to use the Google Apps Script backend.

## Repository map

- `index.html` — employee/kiosk page shell.
- `script.js` — employee clock-in/clock-out frontend behavior.
- `style.css` — shared/employee styling.
- `admin.html` — admin dashboard shell and script load order.
- `admin.js` — core admin dashboard rendering and management actions.
- `admin-reliability.js` — read-only request timeout/retry and dashboard fallback handling.
- `admin-delete.js` — employee deletion UI/behavior.
- `admin-insights-bootstrap.js` — loads optional admin insight/feature bundles after the core dashboard.
- `admin-insights.js` / `admin-insights.css` — employee details, activity log, and system-health UI.
- `admin-final-features.js` / `admin-final-features.css` — payroll range/export, missed-punch filters, and long-shift warnings.
- `admin-polish.js` — isolated reliability/export polish overrides loaded last.
- `admin.css` — admin dashboard styling.

## Admin script load order

Keep the order in `admin.html`:

1. `admin.js`
2. `admin-reliability.js`
3. `admin-delete.js`
4. `admin-insights-bootstrap.js`

`admin-insights-bootstrap.js` then loads the optional insight/final-feature/polish bundles in sequence. Some files intentionally wrap functions created by earlier files, so changing the order can break behavior.

## Safe frontend deployment checklist

After a frontend change:

1. Confirm the edited file is loaded by either `admin.html`, `index.html`, or the appropriate bootstrap loader.
2. If a browser may cache the changed asset, bump its `?v=` value in the file that loads it.
3. Do not change the Apps Script `/exec` URL unless the web-app deployment actually changes.
4. Hard-refresh the affected page once after deployment.
5. Verify the core path before optional features: dashboard load, clock in/out, then payroll/insights/export.

## Apps Script backend changes

Saving Apps Script source is not enough for the production `/exec` endpoint. After a backend change, update the existing web-app deployment to a **new version** so the URL remains stable.

Backend/authentication/payroll/data-model changes should be treated separately from normal frontend maintenance because they can affect employee records or business logic.

## Current maintenance priorities

- Keep normal dashboard refresh payloads small; load large history views only on demand.
- Never automatically retry write actions that could create duplicate mutations.
- Keep authentication/security redesign separate from UI polish.
- Prefer narrow, reversible changes over adding more code to the core files.
