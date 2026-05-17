// =========================================================
// Usage Monitor for Claude - Sniffer Bridge (ISOLATED world)
// =========================================================
// Receives the CustomEvent dispatched by sniffer-main.js (MAIN world)
// and forwards the payload to the background service worker.
// (Only ISOLATED-world content scripts have access to chrome.runtime.)
//
// Silent mode: no console output, all errors swallowed.
// =========================================================

(function () {
  try {
    window.addEventListener('__claudeMonitorCapture', (event) => {
      try {
        const detail = event && event.detail;
        if (!detail || !detail.url || !detail.data) return;
        chrome.runtime.sendMessage({
          type: 'usageCaptured',
          payload: { url: detail.url, data: detail.data, at: detail.at },
        }).catch(() => { /* service worker may be asleep */ });
      } catch (_) { /* ignore */ }
    });
  } catch (_) { /* ignore */ }
})();
