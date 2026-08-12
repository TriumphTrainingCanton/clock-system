// Triumph Training dashboard reliability layer.
// Retries ONLY the read-only dashboard fetch. Write actions are never retried.

(function () {
  if (typeof postToBackend !== "function") return;

  const originalPostToBackend = postToBackend;
  const DASHBOARD_ACTION = "Get Admin Dashboard";
  const DASHBOARD_TIMEOUT_MS = 10000;
  const RETRY_DELAY_MS = 450;

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function fetchDashboardOnce(payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DASHBOARD_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const text = (await response.text()).trim();

      if (!response.ok) {
        throw new Error(`Dashboard request failed with HTTP ${response.status}.`);
      }

      if (!text) {
        throw new Error("Dashboard returned an empty response.");
      }

      if (text.startsWith("<!DOCTYPE html") || text.startsWith("<html")) {
        throw new Error("Dashboard backend returned HTML instead of data.");
      }

      // Validate the payload before handing it back to the normal dashboard renderer.
      JSON.parse(text);
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }

  postToBackend = async function (payload) {
    if (!payload || payload.action !== DASHBOARD_ACTION) {
      return originalPostToBackend(payload);
    }

    let firstError;

    try {
      return await fetchDashboardOnce(payload);
    } catch (error) {
      firstError = error;
      console.warn("Dashboard refresh attempt 1 failed; retrying once.", error);
    }

    await wait(RETRY_DELAY_MS);

    try {
      return await fetchDashboardOnce(payload);
    } catch (secondError) {
      console.error("Dashboard refresh retry failed.", {
        firstError,
        secondError
      });
      throw secondError;
    }
  };
})();
