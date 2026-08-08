// Silence uncaught errors in the options page.
window.addEventListener('error', (e) => { try { e.preventDefault(); } catch (_) {} });
window.addEventListener('unhandledrejection', (e) => { try { e.preventDefault(); } catch (_) {} });
try {
  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    if (typeof console !== 'undefined' && console[m]) console[m] = () => {};
  }
} catch (_) { /* ignore */ }

const DEFAULTS = {
  refreshMinutes: 1,
  warnThreshold: 70,
  criticalThreshold: 90,
  notifyOnThreshold: true,
  notifyOnIncident: true,
};

async function load() {
  try {
    const s = await chrome.storage.sync.get(DEFAULTS);
    const merged = { ...DEFAULTS, ...s };
    document.getElementById('refreshMinutes').value = merged.refreshMinutes;
    document.getElementById('warnThreshold').value = merged.warnThreshold;
    document.getElementById('criticalThreshold').value = merged.criticalThreshold;
    document.getElementById('notifyOnThreshold').checked = merged.notifyOnThreshold;
    document.getElementById('notifyOnIncident').checked = merged.notifyOnIncident;
  } catch (_) { /* ignore */ }
}

// parseInt + fallback that keeps an explicit 0 (`|| dflt` would discard it)
function readInt(id, fallback) {
  const v = parseInt(document.getElementById(id).value, 10);
  return Number.isNaN(v) ? fallback : v;
}

async function save() {
  try {
    const settings = {
      refreshMinutes: Math.max(1, Math.min(60, readInt('refreshMinutes', DEFAULTS.refreshMinutes))),
      warnThreshold: Math.max(0, Math.min(100, readInt('warnThreshold', DEFAULTS.warnThreshold))),
      criticalThreshold: Math.max(0, Math.min(100, readInt('criticalThreshold', DEFAULTS.criticalThreshold))),
      notifyOnThreshold: document.getElementById('notifyOnThreshold').checked,
      notifyOnIncident: document.getElementById('notifyOnIncident').checked,
    };
    await chrome.storage.sync.set(settings);
    try { await chrome.runtime.sendMessage({ type: 'settingsChanged' }); } catch (_) {}

    const msg = document.getElementById('savedMsg');
    msg.classList.add('show');
    setTimeout(() => msg.classList.remove('show'), 2000);
  } catch (_) { /* ignore */ }
}

document.getElementById('saveBtn').addEventListener('click', save);
load();
