// Triumph Training admin reliability layer.
// Retries ONLY read-only admin requests. Write actions are never retried.
// Keeps a short-lived last-known-good dashboard so transient backend hiccups
// do not blank the admin panel or make repeat visits wait through long retries.

(function () {
  if (typeof postToBackend !== "function") return;

  const originalPostToBackend = postToBackend;
  const DASHBOARD_ACTION = "Get Admin Dashboard";
  const PAYROLL_ACTION = "Get Payroll Range";
  const READ_ONLY_ACTIONS = new Set([
    DASHBOARD_ACTION,
    PAYROLL_ACTION,
    "Get Missed Punch Requests",
    "Get Employee Details",
    "Get Admin Activity Log"
  ]);

  const CACHE_KEY = "triumph_admin_dashboard_last_good_v1";
  const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const FIRST_ATTEMPT_TIMEOUT_MS = 10000;
  const PAYROLL_FAST_TIMEOUT_MS = 8000;
  const DASHBOARD_COLD_START_TIMEOUTS_MS = [12000, 18000];
  const READ_RETRY_TIMEOUT_MS = 15000;
  const RETRY_DELAYS_MS = [350, 850];

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function validateResponseText(text, action) {
    const trimmed = String(text || "").trim();

    if (!trimmed) throw new Error(`${action} returned an empty response.`);
    if (trimmed.startsWith("<!DOCTYPE html") || trimmed.startsWith("<html")) {
      throw new Error(`${action} returned HTML instead of data.`);
    }

    if (!trimmed.startsWith("Error:")) {
      JSON.parse(trimmed);
    }

    return trimmed;
  }

  function validateDashboardText(text) {
    const trimmed = validateResponseText(text, DASHBOARD_ACTION);
    if (trimmed.startsWith("Error:")) throw new Error(trimmed);

    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Dashboard returned an invalid data object.");
    }

    return trimmed;
  }

  function saveLastGoodDashboard(text) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), text }));
    } catch (error) {
      console.warn("Could not save dashboard fallback cache.", error);
    }
  }

  function getLastGoodDashboard() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;

      const cached = JSON.parse(raw);
      if (!cached || !cached.text || !cached.savedAt) return null;

      const ageMs = Date.now() - Number(cached.savedAt);
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > CACHE_MAX_AGE_MS) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }

      return { text: validateDashboardText(cached.text), ageMs };
    } catch (error) {
      console.warn("Could not read dashboard fallback cache.", error);
      return null;
    }
  }

  async function fetchReadOnce(payload, timeoutMs) {
    const action = payload && payload.action ? payload.action : "Admin read";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        ...(IS_LEGACY_PAGES ? {} : {
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin"
        }),
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`${action} failed with HTTP ${response.status}.`);
      }

      const text = await response.text();
      return action === DASHBOARD_ACTION
        ? validateDashboardText(text)
        : validateResponseText(text, action);
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(`${action} timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function announceCachedFallback(ageMs) {
    const ageMinutes = Math.max(1, Math.round(ageMs / 60000));

    setTimeout(() => {
      if (typeof setAdminStatus === "function") {
        setAdminStatus(
          `Live refresh delayed. Keeping the last successful dashboard from about ${ageMinutes} min ago.`,
          "processing"
        );
      }

      if (typeof showToast === "function") {
        showToast("Live refresh delayed — existing dashboard kept.", "error");
      }
    }, 0);
  }

  function refreshCacheInBackground(payload) {
    fetchReadOnce(payload, 18000)
      .then(text => {
        saveLastGoodDashboard(text);
        window.__triumphDashboardUsedCache = false;
      })
      .catch(error => console.warn("Background dashboard recovery did not complete.", error));
  }

  async function handleWorkerDashboardRead(payload, cachedBeforeRequest) {
    try {
      const text = await fetchReadOnce(payload, FIRST_ATTEMPT_TIMEOUT_MS);
      saveLastGoodDashboard(text);
      window.__triumphDashboardUsedCache = false;
      return text;
    } catch (firstError) {
      console.warn("Dashboard live refresh attempt failed.", firstError);

      if (cachedBeforeRequest) {
        window.__triumphDashboardUsedCache = true;
        announceCachedFallback(cachedBeforeRequest.ageMs);
        return cachedBeforeRequest.text;
      }

      await wait(RETRY_DELAYS_MS[0] || 350);
      const text = await fetchReadOnce(payload, READ_RETRY_TIMEOUT_MS);
      saveLastGoodDashboard(text);
      window.__triumphDashboardUsedCache = false;
      return text;
    }
  }

  async function handleDashboardRead(payload) {
    const cachedBeforeRequest = getLastGoodDashboard();

    // The official Cloudflare deployment reads the dashboard from Neon, so a
    // refresh should actually return live data. Keep cache only as a fallback.
    if (!IS_LEGACY_PAGES) {
      return handleWorkerDashboardRead(payload, cachedBeforeRequest);
    }

    // Legacy Pages still talks directly to Apps Script. Keep cached-first there
    // so a Google cold start does not block the rollback dashboard.
    if (cachedBeforeRequest) {
      window.__triumphDashboardUsedCache = true;
      refreshCacheInBackground(payload);
      return cachedBeforeRequest.text;
    }

    try {
      const text = await fetchReadOnce(payload, FIRST_ATTEMPT_TIMEOUT_MS);
      saveLastGoodDashboard(text);
      window.__triumphDashboardUsedCache = false;
      return text;
    } catch (firstError) {
      console.warn("Dashboard live refresh attempt failed.", firstError);

      const errors = [firstError];

      for (let attempt = 0; attempt < DASHBOARD_COLD_START_TIMEOUTS_MS.length; attempt++) {
        await wait(RETRY_DELAYS_MS[attempt] || 350);

        try {
          const text = await fetchReadOnce(payload, DASHBOARD_COLD_START_TIMEOUTS_MS[attempt]);
          saveLastGoodDashboard(text);
          window.__triumphDashboardUsedCache = false;
          return text;
        } catch (error) {
          errors.push(error);
          console.warn(`Dashboard cold-start retry ${attempt + 1} failed.`, error);
        }
      }

      throw errors[errors.length - 1] || new Error("Dashboard refresh failed.");
    }
  }

  async function handleReadOnlyAction(payload) {
    try {
      return await fetchReadOnce(payload, FIRST_ATTEMPT_TIMEOUT_MS);
    } catch (firstError) {
      console.warn(`${payload.action} attempt 1 failed; retrying once.`, firstError);
      await wait(350);

      try {
        return await fetchReadOnce(payload, READ_RETRY_TIMEOUT_MS);
      } catch (secondError) {
        console.error(`${payload.action} retry failed.`, { firstError, secondError });
        throw secondError;
      }
    }
  }

  postToBackend = async function (payload) {
    if (!payload || !READ_ONLY_ACTIONS.has(payload.action)) {
      return originalPostToBackend(payload);
    }

    if (payload.action === DASHBOARD_ACTION) {
      return handleDashboardRead(payload);
    }

    // Payroll already has a persistent browser cache and background refresh layer.
    // Do one fast live attempt instead of stacking 10s + retry delays + 15s.
    if (payload.action === PAYROLL_ACTION) {
      return fetchReadOnce(payload, PAYROLL_FAST_TIMEOUT_MS);
    }

    return handleReadOnlyAction(payload);
  };
})();
