# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome **Manifest V3** extension (vanilla JS, no framework, no build step) that shows
Claude.ai usage as a toolbar badge and surfaces Anthropic service status. "Unofficial" —
it relies on claude.ai's *internal, undocumented* usage API.

## Commands

There is **no build, lint, test, or package manager** — files are shipped as-is.

Development loop:
1. `chrome://extensions` → Developer mode → **Load unpacked** → select repo root
2. After editing: click the **reload** ↻ on the extension card (or reload from the
   Extensions page). Reload the claude.ai tab too if you changed `sniffer-*.js`.
3. Inspect the service worker via the "service worker" link on the extension card;
   inspect the popup via right-click → Inspect on the open popup.

Releasing = bump `"version"` in `manifest.json` by hand (currently 1.6.1).

## Architecture — the one thing to understand

Anthropic publishes no usage API, so the extension **learns the endpoint by sniffing
the request the `claude.ai/settings/usage` page makes**, then replays it on a schedule.
This drives the whole content-script design and the MV3 two-world split:

- `sniffer-main.js` runs in the **MAIN world** (`world: "MAIN"` in manifest). It can
  monkey-patch the page's `window.fetch` / `XMLHttpRequest`, but has **no access to
  `chrome.*`**. On a URL matching `USAGE_URL_PATTERN` it dispatches a `CustomEvent`
  (`__claudeMonitorCapture`).
- `sniffer-bridge.js` runs in the **ISOLATED world**. It has `chrome.runtime` but
  cannot see the page's `fetch`. It only listens for that CustomEvent and forwards
  the payload to the background worker (`type: 'usageCaptured'`).
- `background.js` (service worker) persists captured endpoint *paths* into
  `chrome.storage.local.capturedEndpoints`, then on a `chrome.alarms` tick calls
  `fetchUsage()`: it tries captured endpoints first (orgId substituted in), then a
  hardcoded `ALL_ENDPOINTS` fallback list, parses every successful response, updates
  the badge, and fires threshold/incident notifications.

Splitting the sniffer"MAIN captures, ISOLATED relays" is not optional cleanup;
it is the only way to both override page `fetch` and reach `chrome.runtime` in MV3.

### Response parsing is deliberately schema-agnostic

The usage JSON shape is undocumented and **differs across Free/Pro/Max/Team/Enterprise**.
`background.js` therefore does *not* hardcode a schema. `findUsageWindows()` walks the
response tree recursively and `extractPercent()` / `extractRaw()` / `extractResetTime()`
probe a long list of candidate key names and tolerate percent-vs-fraction ambiguity.
When adapting to a new plan, **add key names to those lists** rather than special-casing
a path. `prettyLabel()` maps raw keys to human labels.

### State split

- `chrome.storage.sync` — user settings only (`DEFAULT_SETTINGS`).
- `chrome.storage.local` — cached `lastUsage`/`lastStatus`/`lastError`, the learned
  `capturedEndpoints`, and `lastRawUsage` (powers the popup's Debug panel).

## Conventions that look like bugs but are intentional

- **Silent mode.** Every JS file no-ops `console.*` and `preventDefault()`s `error` /
  `unhandledrejection`, and `background.js` wraps work in `safe()`. This is a product
  decision (don't spam the user's DevTools). **Do not add logging or let errors
  propagate** to "fix" it — debug locally with temporary logs and remove them.
- Errors are surfaced to the **user via the popup UI** (`lastError` →
  rendered state), not via console/throw.
- `NOT_LOGGED_IN` is a sentinel error string the popup special-cases — preserve it.

## Permissions / network scope

Only `claude.ai` and `status.claude.com` (`host_permissions`). The extension must
never call any other origin — that scope is a stated privacy guarantee in the README.
