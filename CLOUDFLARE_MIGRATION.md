# Cloudflare staging migration

This branch creates a separate Cloudflare Worker staging system. It does not
change the production GitHub Pages site or the production Apps Script endpoint.

## Why this should be faster

- Cloudflare serves the existing static portal from its edge network.
- The browser calls a same-origin `/api` Worker instead of a cross-origin Apps
  Script deployment.
- Neon HTTPS queries keep employee lists and admin reads to one low-latency
  request; transactional punch writes use Neon's serverless connection.
- The main admin dashboard is assembled with one Postgres query and one network
  response instead of a chain of backend reads.
- The existing cached-first dashboard and payroll rendering remain in place, so
  the admin sees the last successful state immediately during a refresh.

## Preserved behavior

- Existing employee names, rates, active states, bcrypt PIN hashes, shifts,
  missed-punch requests, and admin activity remain in Neon.
- Clock-in, clock-out, and missed-punch writes keep request IDs and database
  uniqueness checks, so retrying after a timeout cannot create a duplicate.
- Employee removal is a soft delete; completed shifts and payroll history retain
  their employee reference.
- The existing admin PIN is verified by the legacy backend only at login, then
  carried only inside an encrypted HttpOnly same-site session cookie. Dashboard
  refreshes no longer wait on Google and the PIN is absent from JavaScript.
- The current action names and response shapes remain compatible with the
  existing employee and admin interfaces.
- Every punch is committed to Neon and an encrypted Sheet-delivery outbox in
  the same database transaction. Google runs in the background and retries, so
  a slow Sheet can no longer delay or erase a successful punch.

## Staging resources required

1. Create a least-privileged Neon role on the isolated migration branch.
2. Add its pooled connection string as the encrypted `NEON_DATABASE_URL`
   Worker secret.
3. Add `ADMIN_SESSION_SECRET` and `SHEETS_SYNC_KEY` as encrypted Worker secrets.
   `APPS_SCRIPT_URL` is a normal Worker environment variable.
5. Run `002_sheet_sync_outbox.sql` on the isolated Neon branch.
6. Deploy `triumph-clock-system-staging` to a separate `workers.dev` URL.
7. Keep Cloudflare Pages and Apps Script live until the entire checklist below passes.

Never commit a database URL, PIN, PIN hash, role password, or session secret.

## Preserved baseline

Before staging deployment, the isolated branch must continue to report:

- 10 employees and 10 non-empty bcrypt PIN records
- 4 shifts, all completed
- 11.33 completed hours
- $136.85 projected pay
- 0 missed-punch requests

## Deploy verification checklist

- [ ] Staging URL opens on desktop and mobile without changing the live URL.
- [ ] Employee list loads and a forced refresh does not produce an HTML/error response.
- [ ] Each existing employee can authenticate with the same PIN as before.
- [ ] A test employee can clock in once; resubmitting the same request ID does not duplicate the shift.
- [ ] The test employee can clock out once; resubmitting the same request ID does not duplicate the clock-out.
- [ ] A missed clock-out request appears in Admin and duplicate submission is ignored.
- [ ] Approving a missed clock-out closes the correct open shift and updates payroll; rejecting one does not alter a shift.
- [ ] Admin login accepts the existing PIN and the PIN is absent from delivered JavaScript.
- [ ] Dashboard totals, employee management, activity history, payroll ranges, CSV export, and soft delete work.
- [ ] Admin first render shows cached data immediately and background refresh completes without an error.
- [ ] Five consecutive employee-list and dashboard refreshes succeed; record median and slowest response time.
- [ ] Worker logs contain no unhandled exceptions, database credentials, PINs, or PIN hashes.
- [ ] Neon counts and payroll totals match the expected changes from only the test punches.
- [ ] A test punch succeeds while the Apps Script request is delayed, remains
      queued in `sheet_sync_outbox`, and later reaches Sheets exactly once.
- [ ] Live GitHub Pages and Apps Script remain operational throughout staging verification.
- [ ] Cutover occurs only after explicit owner approval and a fresh Neon backup/snapshot.

## Rollback

Before cutover, rollback is simply abandoning the staging URL; production never
moved. After a future cutover, restore the prior public URL to GitHub Pages and
Apps Script, then reconcile any punches accepted during the Cloudflare window
before changing database routing.
