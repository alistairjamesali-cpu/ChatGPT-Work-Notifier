# Security and privacy — v2.4.0

## Browser boundary

The notifier uses the existing Chrome profile and manages only the newly captured notifier window. The native host uses its exact HWND and the extension uses its registered Chrome `windowId`. It does not copy profiles, pass `--user-data-dir`, write Chrome enterprise policy, change shortcuts, or terminate `chrome.exe`.

## Local bridge

The bridge binds IPv4 loopback only at `127.0.0.1:38765`, caps request bodies at 16 KiB, uses short socket timeouts, validates status values, and makes no external HTTP requests. Browser-originated state-changing traffic requires both a Chrome-extension Origin and the active per-managed-session token. Tray/local control-plane POSTs require the same session token. Unauthenticated loopback reads are limited to sanitized health/configuration state.

Internal browser events may carry tab/window IDs and transient routing metadata. The unauthenticated `/state` representation exposes only operational state, numeric progress, update freshness, and completion proof; it omits ChatGPT URLs, conversation identifiers, titles, prompt text, and response text. Authenticated local `POST /dashboard-state` adds only a title sanitized to 180 characters. The managed-session token is removed from the visible ChatGPT URL immediately at document start, is not logged, displayed in the tooltip, or passed on the bridge process command line.

Both event and heartbeat routes use the same strict progress validator. Strings, booleans, arrays, objects, NaN, infinity, negative values, and values above 100 are rejected with HTTP 400 rather than coerced or clamped.

## Extension behavior

Host access is restricted to ChatGPT pages and loopback. Permissions are limited to alarms, notifications, storage, tabs, and windows. The page detector reads rendered DOM state. It does not forge page visibility, synthesize mouse/keyboard input, click Send, press Enter, or call ChatGPT network APIs.

The `Resume` helper writes only to an empty ChatGPT composer and never submits it.

## Recovery safety

Automatic page reload is timeout-only. Before a reload, the current page state is probed again. Active Stop/Continue controls, composer drafts, cleared timeout evidence, navigation to another conversation, and rate limits all block the reload.

The reload uses the normal cached Chrome path. The global limit is one actual reload per 15 minutes and four actual reloads in six hours. Cancelled recovery checks do not consume quota.

A stale monitor heartbeat is recorded as operational telemetry and handled by staged automatic connection/managed-Chrome recovery without a manual-verification alert. Active response evidence still prevents unsafe window recovery.

## Persistent alerts

Manual-action states can bypass focus-based notification suppression so a hidden or focused problem is not silently missed. Page alerts remain until resolved or explicitly dismissed for that incident. Desktop/tray alerts require user dismissal/action where supported.

## Power behavior

Awake protection is a process-scoped Windows execution-state request. It does not edit Windows power plans or lid-close policy.
