// Silence uncaught errors in popup so DevTools stays clean.
window.addEventListener('error', (e) => { try { e.preventDefault(); } catch (_) {} });
window.addEventListener('unhandledrejection', (e) => { try { e.preventDefault(); } catch (_) {} });
try {
  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    if (typeof console !== 'undefined' && console[m]) console[m] = () => {};
  }
} catch (_) { /* ignore */ }

// ===== Helpers =====
function colorForPercent(pct, settings) {
  if (pct >= settings.criticalThreshold) return 'var(--red)';
  if (pct >= settings.warnThreshold)     return 'var(--yellow)';
  return 'var(--green)';
}

function formatResetTime(value) {
  if (!value) return '';
  let v = value;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) v = Number(v.trim());
  // Bare numbers below ~1e12 are epoch seconds, not milliseconds
  if (typeof v === 'number' && v < 1e12) v *= 1000;
  const date = new Date(v);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = date - now;
  if (diffMs < 0) return 'Reset elapsed';

  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `Resets in ${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `Resets in ${hours}h ${minutes}m`;
  return `Resets in ${minutes}m`;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return `${Math.floor(diffSec / 3600)}h ago`;
}

function statusDotClass(indicator) {
  switch (indicator) {
    case 'none': return 'green';
    case 'minor': return 'yellow';
    case 'major':
    case 'critical': return 'red';
    default: return 'gray';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// ===== Render =====
async function render(params) {
  try {
    await renderInternal(params);
  } catch (_) {
    // If rendering fails, show a minimal fallback instead of throwing
    try {
      document.getElementById('content').innerHTML =
        '<div class="section" style="color:var(--muted);font-size:12px;">Loading...</div>';
    } catch (_) {}
  }
}

async function renderInternal({ state, settings }) {
  const content = document.getElementById('content');
  const planEl = document.getElementById('plan');
  const updatedEl = document.getElementById('updated');

  const { lastUsage, lastStatus, lastError, lastRawUsage, capturedEndpoints } = state;
  const hasCaptured = capturedEndpoints && Object.keys(capturedEndpoints).length > 0;

  planEl.textContent = lastUsage?.planName || '';

  let html = '';

  // ---- Usage Section ----
  html += '<div class="section">';
  html += '<div class="section-title">Usage</div>';

  if (lastError?.usage === 'NOT_LOGGED_IN') {
    html += `<div class="error">
      Not logged in to Claude.ai<br>
      <a href="https://claude.ai" target="_blank">Open Claude.ai to log in</a>
    </div>`;
  } else if (lastUsage?.windows?.length) {
    // The background retains the last good snapshot across failed refreshes —
    // when the latest refresh failed, disclose that these numbers are cached
    // instead of presenting them as live.
    if (lastError?.usage) {
      html += `<div class="error" style="background:rgba(245,158,11,0.15);border-left:3px solid var(--yellow);color:var(--fg);">
        ⚠️ Showing cached data — the last refresh failed.
        <details style="margin-top:4px;font-size:11px;">
          <summary style="cursor:pointer;color:var(--muted);">Show error</summary>
          <pre style="background:var(--border);padding:6px;border-radius:3px;font-size:10px;overflow:auto;max-height:100px;">${escapeHtml(lastError.usage)}</pre>
        </details>
      </div>`;
    }
    // Group windows by their `group` field (set in background.js)
    const groups = new Map();
    for (const w of lastUsage.windows) {
      const key = w.group || 'other';
      if (!groups.has(key)) {
        groups.set(key, { label: w.groupLabel || 'Other', windows: [] });
      }
      groups.get(key).windows.push(w);
    }

    let isFirstGroup = true;
    for (const { label: groupLabel, windows } of groups.values()) {
      if (!isFirstGroup) {
        html += `<div style="margin:10px 0 6px;font-weight:600;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(groupLabel)}</div>`;
      } else {
        // First group: replace section title
        html = html.replace(
          '<div class="section-title">Usage</div>',
          `<div class="section-title">${escapeHtml(groupLabel)}</div>`
        );
        isFirstGroup = false;
      }

      for (const w of windows) {
        const color = colorForPercent(w.percent, settings);
        const width = Math.min(100, Math.max(2, w.percent));
        const rawText = w.raw ? ` <span style="color:var(--muted);font-size:10px;">(${w.raw.used} / ${w.raw.limit})</span>` : '';
        html += `
          <div class="window">
            <div class="window-row">
              <span class="window-label">${escapeHtml(w.label)}${rawText}</span>
              <span class="window-value" style="color:${color}">${w.percent}%</span>
            </div>
            <div class="bar">
              <div class="bar-fill" style="width:${width}%;background:${color}"></div>
            </div>
            ${w.resetsAt ? `<div class="reset">${escapeHtml(formatResetTime(w.resetsAt))}</div>` : ''}
          </div>`;
      }
    }
  } else if (lastUsage?.warning || (lastError?.usage && !hasCaptured)) {
    html += `<div class="error" style="background:rgba(245,158,11,0.15);border-left:3px solid var(--yellow);color:var(--fg);">
      <strong>💡 Setup needed</strong><br><br>
      The extension hasn't learned your plan's usage API yet.<br><br>
      <strong>How to fix:</strong><br>
      1. Click the <strong>"📊 Open Usage Page"</strong> button below<br>
      2. Wait for the page to load (~5 seconds)<br>
      3. Reopen this popup — the correct endpoint will be auto-detected
    </div>`;
    if (lastError?.usage) {
      html += `<details style="margin-top:8px;font-size:11px;">
        <summary style="cursor:pointer;color:var(--muted);">Show error</summary>
        <pre style="background:var(--border);padding:6px;border-radius:3px;font-size:10px;overflow:auto;max-height:100px;">${escapeHtml(lastError.usage)}</pre>
      </details>`;
    }
  } else if (lastError?.usage) {
    html += `<div class="error">Could not fetch usage:<br>${escapeHtml(lastError.usage)}</div>`;
  } else {
    html += '<div style="color:var(--muted);font-size:12px;">Loading...</div>';
  }
  html += '</div>';

  // ---- Status Section ----
  html += '<div class="section">';
  html += '<div class="section-title">Service Status</div>';
  if (lastStatus) {
    const dotCls = statusDotClass(lastStatus.indicator);
    html += `<div class="status-line">
      <span class="dot ${dotCls}"></span>
      <span>${escapeHtml(lastStatus.description)}</span>
    </div>`;

    if (lastStatus.components?.length) {
      const key = ['claude.ai', 'Claude API', 'Claude Code'];
      const filtered = lastStatus.components.filter(c =>
        key.some(k => c.name.toLowerCase().includes(k.toLowerCase()))
      );
      if (filtered.length) {
        html += '<div style="margin-top:8px;display:flex;flex-direction:column;gap:4px;">';
        for (const c of filtered) {
          const cls = c.status === 'operational' ? 'green'
                    : c.status === 'degraded_performance' ? 'yellow'
                    : c.status === 'partial_outage' || c.status === 'major_outage' ? 'red'
                    : 'gray';
          html += `<div class="status-line" style="font-size:11px;">
            <span class="dot ${cls}"></span>
            <span style="color:var(--muted)">${escapeHtml(c.name)}</span>
          </div>`;
        }
        html += '</div>';
      }
    }

    if (lastStatus.incidents?.length) {
      for (const inc of lastStatus.incidents) {
        html += `<div class="incident">
          <div><a href="${escapeHtml(inc.url)}" target="_blank">${escapeHtml(inc.name)}</a></div>
          <div class="incident-status">${escapeHtml(inc.status)}</div>
        </div>`;
      }
    }
  } else if (lastError?.status) {
    html += `<div class="error">Could not fetch status: ${escapeHtml(lastError.status)}</div>`;
  } else {
    html += '<div style="color:var(--muted);font-size:12px;">Loading...</div>';
  }
  html += '</div>';

  // ---- Debug section ----
  if (lastRawUsage || hasCaptured) {
    html += `<div class="section">
      <details>
        <summary style="cursor:pointer;color:var(--muted);font-size:11px;">
          🔍 Debug
        </summary>
        <div style="margin-top:6px;">`;

    if (hasCaptured) {
      html += `<div style="font-size:10px;color:var(--muted);margin-bottom:6px;">
        <strong>Captured endpoints (from claude.ai):</strong><br>
        ${Object.keys(capturedEndpoints).map(p => `• ${escapeHtml(p)}`).join('<br>')}
      </div>`;
    }

    if (lastRawUsage) {
      const dataStr = JSON.stringify(lastRawUsage.data, null, 2);
      html += `<textarea readonly id="rawData" style="
        width:100%; height:160px; font-family:monospace; font-size:10px;
        background:var(--border); color:var(--fg); border:0; border-radius:3px;
        padding:6px; resize:vertical; box-sizing:border-box;
      ">${escapeHtml(dataStr)}</textarea>
      <button id="copyRawBtn" style="margin-top:6px;width:100%;font-size:11px;padding:4px;">
        📋 Copy raw JSON
      </button>`;
    }

    html += `</div></details></div>`;
  }

  content.innerHTML = html;

  const copyBtn = document.getElementById('copyRawBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const ta = document.getElementById('rawData');
      try {
        await navigator.clipboard.writeText(ta.value);
        copyBtn.textContent = '✅ Copied!';
      } catch (e) {
        ta.select();
        document.execCommand('copy');
        copyBtn.textContent = '✅ Copied!';
      }
      setTimeout(() => copyBtn.textContent = '📋 Copy raw JSON', 2000);
    });
  }

  // Age the footer off the usage data itself — a successful status fetch must
  // not stamp a retained stale usage snapshot as freshly updated.
  const updatedAt = lastUsage?.fetchedAt || lastStatus?.fetchedAt || 0;
  updatedEl.textContent = updatedAt
    ? `Last updated: ${formatRelativeTime(updatedAt)}`
    : '';
}

async function load() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'getState' });
    if (resp) render(resp);
  } catch (_) { /* ignore */ }
}

document.getElementById('refreshBtn').addEventListener('click', async () => {
  const btn = document.getElementById('refreshBtn');
  try {
    btn.disabled = true;
    btn.textContent = '⏳ Refreshing...';
    await chrome.runtime.sendMessage({ type: 'refresh' });
    await load();
  } catch (_) { /* ignore */ }
  finally {
    btn.disabled = false;
    btn.textContent = '🔄 Refresh';
  }
});

document.getElementById('optionsBtn').addEventListener('click', () => {
  try { chrome.runtime.openOptionsPage(); } catch (_) {}
});

document.getElementById('openClaudeBtn').addEventListener('click', () => {
  try { chrome.tabs.create({ url: 'https://claude.ai/settings/usage' }); } catch (_) {}
});

load();
