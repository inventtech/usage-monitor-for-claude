# Privacy Policy — Usage Monitor for Claude

**Last updated:** 2026-05-18

## Overview

Usage Monitor for Claude is an unofficial browser extension that displays your Claude.ai usage as a toolbar badge and notifies you about usage thresholds and service incidents.

## Data Collection

**This extension does not collect, transmit, or share any user data.**

All data remains entirely on your device:

- **Usage statistics** fetched from your Claude.ai account are cached locally in `chrome.storage.local` and never sent anywhere else.
- **User preferences** (polling interval, notification thresholds, display settings) are stored in `chrome.storage.sync` for cross-device sync via your browser profile — this is a built-in Chrome feature, not a third-party service.
- **Service status** fetched from status.claude.com is cached locally and never forwarded.

## Network Access

The extension only communicates with two origins:

| Origin | Purpose |
|---|---|
| `claude.ai` | Fetch your own usage data using your existing authenticated session |
| `status.claude.com` | Check Anthropic's public service status page |

No other servers, analytics services, or third-party endpoints are contacted.

## Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Save your preferences and cache usage data locally |
| `alarms` | Periodically refresh usage data in the background |
| `notifications` | Alert you when usage reaches your configured threshold or when service incidents occur |
| Host access to `claude.ai` | Read your usage data from your own account |
| Host access to `status.claude.com` | Check service status |

## Third Parties

This extension does not use any third-party services, SDKs, analytics, or tracking of any kind.

## Changes

If this policy changes, the update will be reflected in this file with an updated date.

## Contact

For questions about this policy, open an issue on the [GitHub repository](https://github.com/inventtech/usage-monitor-for-claude).
