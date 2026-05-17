// =========================================================
// Usage Monitor for Claude - Sniffer (MAIN world)
// =========================================================
// Runs in the MAIN world so we can override the page's window.fetch.
// When claude.ai calls a usage/limits endpoint, dispatch a CustomEvent
// so that sniffer-bridge.js (ISOLATED world) can forward it to background.
//
// Silent mode: no console output; any error is swallowed.
// =========================================================

(function () {
  try {
    if (window.__claudeMonitorSnifferInstalled) return;
    window.__claudeMonitorSnifferInstalled = true;
  } catch (_) { return; }

  // Suppress uncaught errors and rejections originating from this script
  // (they would otherwise show in DevTools and worry users).
  try {
    window.addEventListener('error', function (e) {
      try {
        const f = e && e.filename;
        if (typeof f === 'string' && f.indexOf('sniffer-main.js') !== -1) {
          e.preventDefault();
        }
      } catch (_) {}
    }, true);
  } catch (_) {}

  const USAGE_URL_PATTERN = /\/api\/(organizations\/[^/]+\/)?(usage|limits|rate_limits|usage_v2|usage_overview)/i;

  function dispatch(url, data) {
    try {
      window.dispatchEvent(new CustomEvent('__claudeMonitorCapture', {
        detail: { url, data, at: Date.now() }
      }));
    } catch (_) { /* ignore */ }
  }

  // ------- Override fetch -------
  try {
    const origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      let url;
      try {
        url = typeof input === 'string' ? input : (input && input.url) || '';
      } catch (_) { url = ''; }

      let pending;
      try { pending = origFetch(input, init); } catch (_) { pending = Promise.reject(); }

      // Inspect the response without affecting the caller
      pending.then((resp) => {
        try {
          if (!resp || !resp.ok || !url) return;
          if (!USAGE_URL_PATTERN.test(url)) return;
          const ct = (resp.headers && resp.headers.get('content-type')) || '';
          if (ct.indexOf('json') === -1) return;
          resp.clone().json().then((data) => dispatch(url, data)).catch(() => {});
        } catch (_) { /* ignore */ }
      }).catch(() => { /* original caller handles errors */ });

      return pending;
    };
  } catch (_) { /* ignore */ }

  // ------- Override XMLHttpRequest (just in case) -------
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__claudeMonitorUrl = url; } catch (_) {}
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      try {
        const url = this.__claudeMonitorUrl;
        if (url && USAGE_URL_PATTERN.test(url)) {
          this.addEventListener('load', () => {
            try {
              if (this.status >= 200 && this.status < 300) {
                const data = JSON.parse(this.responseText);
                dispatch(url, data);
              }
            } catch (_) { /* ignore */ }
          });
        }
      } catch (_) { /* ignore */ }
      return origSend.apply(this, arguments);
    };
  } catch (_) { /* ignore */ }
})();
