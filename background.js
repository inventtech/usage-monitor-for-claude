// =========================================================
// Usage Monitor for Claude - Background Service Worker (v1.6)
// =========================================================
// Changes from v1.1:
//   - Try multiple endpoints for Free/Pro/Max and Enterprise
//   - Robust parser: find usage windows in any nested structure
//   - Separate endpoints for session limit / weekly limit / daily routine
//   - Support different field names across plans
//   - Store endpoint + raw response for debugging
//   - v1.6: silent mode — no console output, swallow all uncaught errors
// =========================================================

// Silence all uncaught errors and unhandled rejections so the extension
// never spams the user's console.
self.addEventListener('error', (e) => { try { e.preventDefault(); } catch (_) {} });
self.addEventListener('unhandledrejection', (e) => { try { e.preventDefault(); } catch (_) {} });

// Replace console methods with no-ops so any stray logging stays quiet.
try {
  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    if (typeof console !== 'undefined' && console[m]) console[m] = () => {};
  }
} catch (_) { /* ignore */ }

const DEFAULT_SETTINGS = {
  refreshMinutes: 1,
  warnThreshold: 70,
  criticalThreshold: 90,
  notifyOnThreshold: true,
  notifyOnIncident: true,
};

const ALL_ENDPOINTS = [
  // Common across Pro/Max/Free
  '/api/organizations/{orgId}/usage',
  '/api/organizations/{orgId}/usage_v2',
  '/api/organizations/{orgId}/usage/limits',
  '/api/organizations/{orgId}/limits',
  '/api/organizations/{orgId}/rate_limits',
  // Enterprise / Team
  '/api/organizations/{orgId}/usage_overview',
  '/api/organizations/{orgId}/billing/usage',
  '/api/organizations/{orgId}/quota',
  '/api/organizations/{orgId}/quotas',
  '/api/organizations/{orgId}/usage_summary',
  '/api/organizations/{orgId}/account_usage',
  '/api/organizations/{orgId}/billing/quota',
  '/api/organizations/{orgId}/settings/usage',
  // Others
  '/api/account/usage',
  '/api/user/usage',
  '/api/usage',
];

// -------------------- Storage --------------------
async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function getState() {
  return await chrome.storage.local.get([
    'lastUsage', 'lastStatus', 'lastError', 'lastIncidentIds',
    'lastRawUsage', 'capturedEndpoints'
  ]);
}

// Track endpoints captured from the claude.ai/settings/usage page
// (ground truth — endpoints the page actually uses)
async function recordCapturedEndpoint(url, data) {
  const state = await chrome.storage.local.get('capturedEndpoints');
  const captured = state.capturedEndpoints || {};

  // Store path part (so it works across organizations)
  try {
    const u = new URL(url);
    captured[u.pathname] = {
      lastUrl: url,
      lastSeen: Date.now(),
      sampleData: data, // keep sample to inspect structure
    };
    await chrome.storage.local.set({ capturedEndpoints: captured });

    // Refresh immediately when fresh data arrives
    refresh();
  } catch (_) {
    /* swallow */
  }
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

// -------------------- Generic Percent Parser --------------------

/**
 * Extract a usage percent from an object of arbitrary shape.
 *
 * Note: Anthropic returns utilization as a 0-100 percentage,
 * e.g. { utilization: 50 } means 50%,
 * NOT a fraction (0-1).
 */
function extractPercent(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  // 1) Direct percent fields (0-100)
  for (const k of ['percent_used', 'percent', 'percentage', 'usage_percent', 'usage_percentage']) {
    if (typeof obj[k] === 'number') {
      const v = obj[k];
      // > 1: confidently a percent
      // <= 1: ambiguous (could be a fraction or just a tiny percent)
      if (v > 1) return Math.round(v);
      if (v === 0) return 0;
      // 0 < v <= 1: try to disambiguate
      // If used/limit are present, use those
      const raw = extractRaw(obj);
      if (raw && raw.limit > 0) {
        return Math.min(100, Math.round((raw.used / raw.limit) * 100));
      }
      // 0-1 range: treat as fraction
      return Math.round(v * 100);
    }
  }

  // 2) utilization (Anthropic format: 0-100)
  if (typeof obj.utilization === 'number') {
    const v = obj.utilization;
    if (v === 0) return 0;
    // utilization > 1: it is a percent
    if (v > 1) return Math.min(100, Math.round(v));
    // 0 < utilization <= 1: rare in Anthropic responses,
    // but Enterprise may use fractions — disambiguate via other fields
    const raw = extractRaw(obj);
    if (raw && raw.limit > 0) {
      return Math.min(100, Math.round((raw.used / raw.limit) * 100));
    }
    // fallback: treat as a fraction
    return Math.round(v * 100);
  }

  // 3) used / limit
  const usedKeys  = ['used', 'used_tokens', 'used_count', 'used_credits', 'current', 'consumed', 'count', 'value', 'usage'];
  const limitKeys = ['limit', 'monthly_limit', 'total', 'max', 'cap', 'quota', 'allowed', 'limit_value', 'max_value'];
  let used = null, limit = null;
  for (const k of usedKeys)  if (typeof obj[k] === 'number') { used = obj[k]; break; }
  for (const k of limitKeys) if (typeof obj[k] === 'number') { limit = obj[k]; break; }
  if (used !== null && limit && limit > 0) {
    return Math.min(100, Math.round((used / limit) * 100));
  }
  if (used !== null && limit === 0) return 0;
  return null;
}

function extractResetTime(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of [
    'resets_at', 'reset_at', 'resetsAt', 'resetAt',
    'expires_at', 'expiresAt',
    'next_reset_at', 'nextResetAt',
    'reset_time', 'resetTime',
    'window_end', 'windowEnd', 'end_time', 'endTime'
  ]) {
    if (obj[k]) return obj[k];
  }
  return null;
}

function extractRaw(obj) {
  // Extract raw used/limit numbers for display (e.g. "0 / 25")
  if (!obj || typeof obj !== 'object') return null;
  const usedKeys  = ['used', 'used_count', 'current', 'consumed', 'count', 'value'];
  const limitKeys = ['limit', 'total', 'max', 'cap', 'quota', 'allowed'];
  let used = null, limit = null;
  for (const k of usedKeys)  if (typeof obj[k] === 'number') { used = obj[k]; break; }
  for (const k of limitKeys) if (typeof obj[k] === 'number') { limit = obj[k]; break; }
  if (used !== null && limit !== null) return { used, limit };
  return null;
}

/**
 * Map raw keys to human-friendly labels
 */
function prettyLabel(rawLabel) {
  const mapping = {
    // Pro/Max plan keys (observed in real /usage responses)
    'five_hour': '5-Hour Session',
    'fivehour': '5-Hour Session',
    'seven_day': 'Weekly (All Models)',
    'sevenday': 'Weekly (All Models)',
    'seven_day_sonnet': 'Weekly (Sonnet)',
    'sevendaysonnet': 'Weekly (Sonnet)',
    'seven_day_opus': 'Weekly (Opus)',
    'sevendayopus': 'Weekly (Opus)',
    'seven_day_haiku': 'Weekly (Haiku)',
    'seven_day_cowork': 'Weekly (Cowork)',
    'seven_day_oauth_apps': 'Weekly (OAuth Apps)',
    'seven_day_omelette': 'Weekly (Skills)',
    'extra_usage': 'Extra Credits',

    // Enterprise/Team keys
    'current_session': 'Current Session',
    'session': 'Session',
    'weekly': 'Weekly',
    'weekly_opus': 'Weekly (Opus)',
    'opus_weekly': 'Weekly (Opus)',
    'all_models': 'Weekly (All Models)',
    'claude_design': 'Claude Design',
    'daily': 'Daily',
    'monthly': 'Monthly',
    'routine_runs': 'Routine Runs',
    'daily_routine_runs': 'Daily Routine Runs',
    'daily_included_routine_runs': 'Daily Routine Runs',
  };

  const normalized = String(rawLabel)
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (mapping[normalized]) return mapping[normalized];

  // fallback: snake_case → Title Case
  return String(rawLabel)
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Walk an object recursively and collect anything that looks like a usage window
 */
function findUsageWindows(root) {
  const windows = [];
  const visited = new WeakSet();

  function walk(node, path, parentKey) {
    try {
      if (!node || typeof node !== 'object' || visited.has(node)) return;
      visited.add(node);

      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${path}[${i}]`, parentKey));
        return;
      }

      // Is this node itself a window?
      const pct = extractPercent(node);
      if (pct !== null && pct >= 0 && pct <= 100) {
        // Skip windows that look unused (0% + no reset time + no used/limit)
        const resetsAt = extractResetTime(node);
        const raw = extractRaw(node);
        const looksUnused = pct === 0 && !resetsAt && !raw;
        if (looksUnused) {
          // Keep if it has an explicit name — the user probably wants to see it
          const hasExplicitName = node.name || node.label || node.display_name || node.title;
          if (!hasExplicitName) {
            // Skip placeholder-like { utilization: 0 } nodes
            for (const [k, v] of Object.entries(node)) {
              walk(v, path ? `${path}.${k}` : k, k);
            }
            return;
          }
        }

        let label = node.name || node.label || node.display_name
                  || node.title || node.type || node.key
                  || parentKey;
        if (!label) {
          const parts = path.split('.').filter(p => !p.match(/^\[\d+\]$/));
          label = parts[parts.length - 1] || 'Usage';
        }

        windows.push({
          label: prettyLabel(label),
          rawLabel: String(label),
          percent: pct,
          resetsAt,
          raw,
          path,
        });
      }

      for (const [k, v] of Object.entries(node)) {
        walk(v, path ? `${path}.${k}` : k, k);
      }
    } catch (_) { /* ignore one bad subtree */ }
  }

  try {
    walk(root, '', '');
  } catch (_) { /* ignore */ }

  // Dedup by (label, percent, path)
  try {
    const seen = new Set();
    return windows.filter(w => {
      const key = `${w.rawLabel}:${w.percent}:${w.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (_) {
    return windows;
  }
}

function extractPlanName(orgsData, usageData) {
  try {
    // 1) From rate_limit_tier (found in /rate_limits response)
    if (typeof usageData?.rate_limit_tier === 'string') {
      const tier = usageData.rate_limit_tier;
      // 'default_claude_max_5x' → 'Max (5x)'
      // 'default_claude_pro' → 'Pro'
      // 'default_claude_ai' → 'Free'
      const match = tier.match(/claude_(\w+?)(?:_(\d+x))?$/);
      if (match) {
        const planKey = match[1];
        const multiplier = match[2];
        const labels = {
          'ai': 'Free',
          'free': 'Free',
          'pro': 'Pro',
          'max': 'Max',
          'team': 'Team',
          'enterprise': 'Enterprise',
        };
        const label = labels[planKey] || planKey.charAt(0).toUpperCase() + planKey.slice(1);
        return multiplier ? `${label} (${multiplier})` : label;
      }
      return tier;
    }

    if (usageData?.plan) return usageData.plan;
    if (usageData?.plan_name) return usageData.plan_name;
    if (usageData?.plan_type) return usageData.plan_type;
    if (usageData?.subscription?.plan_type) return usageData.subscription.plan_type;

    const org = Array.isArray(orgsData) ? orgsData[0] : orgsData;
    if (!org) return 'Unknown';

    if (org.organization_type) {
      const t = org.organization_type;
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    }

    const sub = org.settings?.claude_pro_subscription;
    if (sub?.plan_type) {
      return sub.plan_type.charAt(0).toUpperCase() + sub.plan_type.slice(1).toLowerCase();
    }

    const caps = org.capabilities || [];
    if (caps.includes('claude_max'))   return 'Max';
    if (caps.includes('claude_pro'))   return 'Pro';
    if (caps.includes('claude_team'))  return 'Team';
    if (caps.includes('enterprise'))   return 'Enterprise';

    return 'Free';
  } catch (_) {
    return 'Unknown';
  }
}

// -------------------- Usage Fetcher --------------------
async function fetchUsage() {
  // Step 1: get organizations
  const orgsResp = await fetch('https://claude.ai/api/organizations', {
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  });

  if (orgsResp.status === 401 || orgsResp.status === 403) {
    throw new Error('NOT_LOGGED_IN');
  }
  if (!orgsResp.ok) {
    throw new Error(`Organizations API: HTTP ${orgsResp.status}`);
  }

  const orgs = await orgsResp.json();
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new Error('No organizations found');
  }
  const orgId = orgs[0].uuid;

  // Step 2: assemble the list of endpoints to try
  // 1) captured endpoints (ground truth from settings/usage page)
  // 2) known endpoints (hardcoded list)
  const stored = await chrome.storage.local.get('capturedEndpoints');
  const captured = stored.capturedEndpoints || {};

  const endpointPaths = new Set();
  // captured first
  for (const path of Object.keys(captured)) {
    // Substitute the current orgId into the captured path
    const normalized = path.replace(/\/organizations\/[^/]+\//, `/organizations/${orgId}/`);
    endpointPaths.add(normalized);
  }
  // known
  for (const template of ALL_ENDPOINTS) {
    endpointPaths.add(template.replace('{orgId}', orgId));
  }

  // Try every endpoint
  const triedResults = [];
  const errors = [];

  for (const path of endpointPaths) {
    const url = `https://claude.ai${path}`;
    try {
      const resp = await fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      if (resp.ok) {
        const data = await resp.json();
        triedResults.push({ endpoint: url, data });
      } else if (resp.status !== 404) {
        errors.push(`${path} → HTTP ${resp.status}`);
      }
    } catch (e) {
      errors.push(`${path} → ${e.message}`);
    }
  }

  if (triedResults.length === 0) {
    throw new Error(
      `No usage endpoint returned data.\n` +
      `Tip: open https://claude.ai/settings/usage and wait 5 seconds — ` +
      `the extension will capture the correct endpoint automatically.\n\n` +
      `Errors:\n${errors.join('\n')}`
    );
  }

  // Aggregate windows across all successful responses
  let allWindows = [];
  for (const r of triedResults) {
    const ws = findUsageWindows(r.data);
    // Tag each window with its origin endpoint (for debugging)
    for (const w of ws) w.fromEndpoint = r.endpoint;
    allWindows = allWindows.concat(ws);
  }

  // Dedup across endpoints — first occurrence wins
  const dedup = new Map();
  for (const w of allWindows) {
    const key = w.label;
    if (!dedup.has(key)) dedup.set(key, w);
  }
  const windows = Array.from(dedup.values());

  // Sort: highest % first (so the most pressing usage shows up at the top)
  windows.sort((a, b) => b.percent - a.percent);

  // Keep raw data around for the debug panel
  await setState({
    lastRawUsage: {
      endpoints: triedResults.map(r => r.endpoint),
      data: triedResults.length === 1 ? triedResults[0].data : triedResults,
      errors,
    }
  });

  const planName = extractPlanName(
    orgs,
    // Combine all responses so extractPlanName can find rate_limit_tier
    triedResults.reduce((acc, r) => ({ ...acc, ...r.data }), {})
  );

  if (windows.length === 0) {
    return {
      planName,
      maxPercent: 0,
      windows: [],
      warning: 'No usage windows found in response — please copy raw JSON and send to developer',
      fetchedAt: Date.now(),
    };
  }

  const maxPercent = Math.max(...windows.map(w => w.percent));

  return {
    planName,
    maxPercent,
    windows,
    fetchedAt: Date.now(),
  };
}

// -------------------- Status Fetcher --------------------
async function fetchStatus() {
  const resp = await fetch('https://status.claude.com/api/v2/summary.json');
  if (!resp.ok) throw new Error(`Status API: HTTP ${resp.status}`);
  const data = await resp.json();

  const indicator = data?.status?.indicator || 'none';
  const description = data?.status?.description || 'Unknown';

  const components = (data.components || []).map(c => ({
    name: c.name,
    status: c.status,
  }));

  const activeIncidents = (data.incidents || []).filter(
    i => i.status !== 'resolved' && i.status !== 'postmortem'
  );

  return {
    indicator,
    description,
    components,
    incidents: activeIncidents.map(i => ({
      id: i.id,
      name: i.name,
      status: i.status,
      url: i.shortlink,
      updatedAt: i.updated_at,
    })),
    fetchedAt: Date.now(),
  };
}

// -------------------- Badge --------------------
async function updateBadge(usage, status, settings) {
  let text = '';
  let bgColor = '#10a37f';
  let title = 'Usage Monitor for Claude';

  if (status && (status.indicator === 'critical' || status.indicator === 'major')) {
    text = '!';
    bgColor = '#dc2626';
    title = `🔴 ${status.description}`;
  } else if (usage && usage.windows?.length) {
    const pct = usage.maxPercent;
    text = pct >= 100 ? '100' : String(pct);

    if (pct >= settings.criticalThreshold) {
      bgColor = '#dc2626';
    } else if (pct >= settings.warnThreshold) {
      bgColor = '#f59e0b';
    } else {
      bgColor = '#10a37f';
    }

    const windowSummary = usage.windows.map(w => `${w.label}: ${w.percent}%`).join(' | ');
    title = `Claude ${usage.planName} — ${windowSummary}`;

    if (status && status.indicator === 'minor') {
      title = `⚠️ ${status.description}\n${title}`;
    }
  } else {
    text = '?';
    bgColor = '#6b7280';
    title = 'Usage Monitor for Claude — could not fetch usage';
  }

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: bgColor });
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  }
  await chrome.action.setTitle({ title });
}

// -------------------- Notifications --------------------
async function maybeNotify(usage, status, prev, settings) {
  if (settings.notifyOnThreshold && usage && prev?.lastUsage) {
    const oldPct = prev.lastUsage.maxPercent ?? 0;
    const newPct = usage.maxPercent ?? 0;
    if (oldPct < settings.criticalThreshold && newPct >= settings.criticalThreshold) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '🔴 Claude Usage Critical',
        message: `Usage has reached ${newPct}%`,
        priority: 2,
      });
    } else if (oldPct < settings.warnThreshold && newPct >= settings.warnThreshold) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '⚠️ Claude Usage Warning',
        message: `Usage has reached ${newPct}%`,
        priority: 1,
      });
    }
  }

  if (settings.notifyOnIncident && status) {
    const prevIds = new Set(prev?.lastIncidentIds || []);
    const newIncidents = (status.incidents || []).filter(i => !prevIds.has(i.id));
    for (const inc of newIncidents) {
      chrome.notifications.create(`incident-${inc.id}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '🚨 Claude Incident',
        message: inc.name,
        priority: 2,
      });
    }
    await setState({ lastIncidentIds: status.incidents.map(i => i.id) });
  }
}

// -------------------- Main --------------------
// Helper: run an async function and swallow any errors silently.
async function safe(fn) {
  try { return await fn(); } catch (_) { return undefined; }
}

async function refresh() {
  const settings = await safe(getSettings) ?? DEFAULT_SETTINGS;
  const prev = await safe(getState) ?? {};

  let usage = null, usageError = null;
  try {
    usage = await fetchUsage();
  } catch (e) {
    usageError = (e && e.message) ? e.message : 'unknown error';
  }

  let status = null, statusError = null;
  try {
    status = await fetchStatus();
  } catch (e) {
    statusError = (e && e.message) ? e.message : 'unknown error';
  }

  await safe(() => setState({
    lastUsage: usage,
    lastStatus: status,
    lastError: { usage: usageError, status: statusError, at: Date.now() },
  }));

  await safe(() => updateBadge(usage, status, settings));
  await safe(() => maybeNotify(usage, status, prev, settings));
}

async function setupAlarm() {
  try {
    const { refreshMinutes } = await getSettings();
    await chrome.alarms.clear('refresh');
    await chrome.alarms.create('refresh', {
      periodInMinutes: Math.max(1, refreshMinutes),
    });
  } catch (_) { /* ignore */ }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  try {
    if (alarm.name === 'refresh') refresh().catch(() => {});
  } catch (_) { /* ignore */ }
});

chrome.runtime.onInstalled.addListener(() => {
  (async () => {
    await safe(setupAlarm);
    await safe(refresh);
  })();
});

chrome.runtime.onStartup.addListener(() => {
  (async () => {
    await safe(setupAlarm);
    await safe(refresh);
  })();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'refresh') {
        await safe(refresh);
        try { sendResponse({ ok: true }); } catch (_) {}
      } else if (msg?.type === 'settingsChanged') {
        await safe(setupAlarm);
        await safe(refresh);
        try { sendResponse({ ok: true }); } catch (_) {}
      } else if (msg?.type === 'getState') {
        const state = await safe(getState) ?? {};
        const settings = await safe(getSettings) ?? DEFAULT_SETTINGS;
        try { sendResponse({ state, settings }); } catch (_) {}
      } else if (msg?.type === 'usageCaptured') {
        // From content-script: settings/usage page just made an API call
        await safe(() => recordCapturedEndpoint(msg.payload.url, msg.payload.data));
        try { sendResponse({ ok: true }); } catch (_) {}
      } else {
        try { sendResponse({ ok: false }); } catch (_) {}
      }
    } catch (_) {
      try { sendResponse({ ok: false }); } catch (_) {}
    }
  })();
  return true;
});
