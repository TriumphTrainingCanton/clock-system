// Triumph Training dashboard reliability layer.
// Retries ONLY the read-only dashboard fetch. Write actions are never retried.
// Keeps a short-lived last-known-good dashboard so transient Apps Script hiccups
// do not blank the admin panel or make repeat visits wait through long retries.

(function () {
  if (typeof postToBackend !== "function") return;

  const originalPostToBackend = postToBackend;
  const DASHBOARD_ACTION = "Get Admin Dashboard";
  const CACHE_KEY = "triumph_admin_dashboard_last_good_v1";
  const CACHE_MAX_AGE_MS = 15 * 60 * 1000;
  const FIRST_ATTEMPT_TIMEOUT_MS = 10000;
  const COLD_START_TIMEOUTS_MS = [12000, 18000];
  const RETRY_DELAYS_MS = [350, 850];

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function validateDashboardText(text) {
    const trimmed = String(text || "").trim();

    if (!trimmed) throw new Error("Dashboard returned an empty response.");
    if (trimmed.startsWith("<!DOCTYPE html") || trimmed.startsWith("<html")) {
      throw new Error("Dashboard backend returned HTML instead of data.");
    }

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

  async function fetchDashboardOnce(payload, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Dashboard request failed with HTTP ${response.status}.`);
      }

      return validateDashboardText(await response.text());
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(`Dashboard request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
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
          `Google is responding slowly. Keeping the last successful dashboard from about ${ageMinutes} min ago.`,
          "processing"
        );
      }

      if (typeof showToast === "function") {
        showToast("Live refresh delayed — existing dashboard kept.", "error");
      }
    }, 0);
  }

  function refreshCacheInBackground(payload) {
    fetchDashboardOnce(payload, 18000)
      .then(text => saveLastGoodDashboard(text))
      .catch(error => console.warn("Background dashboard recovery did not complete.", error));
  }

  postToBackend = async function (payload) {
    if (!payload || payload.action !== DASHBOARD_ACTION) {
      return originalPostToBackend(payload);
    }

    const cachedBeforeRequest = getLastGoodDashboard();

    try {
      const text = await fetchDashboardOnce(payload, FIRST_ATTEMPT_TIMEOUT_MS);
      saveLastGoodDashboard(text);
      window.__triumphDashboardUsedCache = false;
      return text;
    } catch (firstError) {
      console.warn("Dashboard live refresh attempt failed.", firstError);

      // Returning users should stay responsive: keep their recent good dashboard
      // and recover the live cache separately instead of blocking the UI on retries.
      if (cachedBeforeRequest) {
        window.__triumphDashboardUsedCache = true;
        announceCachedFallback(cachedBeforeRequest.ageMs);
        refreshCacheInBackground(payload);
        return cachedBeforeRequest.text;
      }

      // First load with no cache gets controlled cold-start retries.
      const errors = [firstError];

      for (let attempt = 0; attempt < COLD_START_TIMEOUTS_MS.length; attempt++) {
        await wait(RETRY_DELAYS_MS[attempt] || 350);

        try {
          const text = await fetchDashboardOnce(payload, COLD_START_TIMEOUTS_MS[attempt]);
          saveLastGoodDashboard(text);
          window.__triumphDashboardUsedCache = false;
          return text;
        } catch (error) {
          errors.push(error);
          console.warn(`Dashboard cold-start retry ${attempt + 1} failed.`, error);
        }
      }

      console.error("Dashboard refresh failed with no usable fallback.", errors);
      throw errors[errors.length - 1] || new Error("Dashboard refresh failed.");
    }
  };
})();
