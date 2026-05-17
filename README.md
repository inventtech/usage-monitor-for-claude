# Usage Monitor for Claude — Chrome Extension

Show **Claude.ai usage as a percentage** on your toolbar (like Gmail's unread
badge) and **Anthropic service status**, all in one place.

![icon](icons/icon128.png)

## ✨ Features

- **Numeric % badge** on the toolbar icon — see your usage at a glance
- **Color-coded badge** — 🟢 normal / 🟡 warning / 🔴 critical
- **Auto-refresh** every minute (configurable)
- **Service status** from status.claude.com — see incidents instantly
- **Notifications** when usage crosses a threshold or a new incident is reported
- **Click for details**: 5-hour session, weekly limit, weekly Opus/Sonnet, reset times
- **Plan-aware** — works with Free, Pro, Max, Team, and Enterprise
- **No setup** — uses your browser's existing claude.ai session

## 📦 Installation (Load Unpacked)

1. Open Chrome → `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Pin the icon to your toolbar (📌)

## 🚀 First-Time Use

1. Log in to [claude.ai](https://claude.ai) as you normally would
2. Click the extension icon → click **📊 Open Usage Page**
3. Wait ~5 seconds for the page to load — the extension auto-detects the right endpoint
4. Reopen the popup — you'll see your usage data

> **Why open the usage page first?**
> Anthropic doesn't publish an official usage API. The extension sniffs the
> internal request made by `claude.ai/settings/usage` once, then reuses that
> endpoint for auto-refresh. After the first capture, no further action is needed.

## 🎨 Badge Colors

| Badge | Meaning |
|---|---|
| 🟢 green + number | Usage below warn threshold (default 70%) |
| 🟡 yellow + number | Usage at or above warn threshold |
| 🔴 red + number | Usage at or above critical threshold (default 90%) |
| 🔴 red + `!` | Major outage on Anthropic services |
| ⚫ gray + `?` | Could not fetch data — log in or open the usage page |

## ⚙️ Settings

- Auto-refresh interval (1–60 minutes, default **1 minute**)
- Warning threshold (default 70%)
- Critical threshold (default 90%)
- Toggle threshold notifications
- Toggle incident notifications

## 🔍 Debugging

If the badge shows `?` or the percentage looks wrong:

1. Click the icon → expand the **🔍 Debug** section
2. Review the captured endpoints and raw JSON
3. Click **📋 Copy raw JSON** to send to the developer

## 📁 File Layout

```
claude-monitor-extension/
├── manifest.json       # Manifest V3
├── background.js       # Service worker (fetch + parse + badge)
├── sniffer-main.js     # MAIN-world script: overrides fetch on claude.ai
├── sniffer-bridge.js   # ISOLATED-world script: forwards to background
├── popup.html/.js      # Toolbar popup UI
├── options.html/.js    # Settings page
└── icons/              # 16/32/48/128 px icons
```

## 🔐 Permissions

- `storage` — store settings and cached data
- `alarms` — schedule auto-refresh
- `notifications` — alert on threshold/incident
- `host_permissions: claude.ai, status.claude.com` — only these two domains

No data is sent to any other server.

## ⚠️ Caveats

The claude.ai usage endpoint is **internal** (not officially documented). If
Anthropic changes the response shape, the extension's auto-discovery will pick
up the new endpoint when you next open the usage page, but the parser may need
updating if field names change.
