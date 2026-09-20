# Architecture — v2.4.0

## Components

1. `runtime/tray-host.ps1` owns the Windows tray UI, TopMost manual-action popup, awake request, captured Chrome HWND, dashboard, and native recovery controller.
2. `runtime/browser-bridge.ps1` is a private loopback status/command broker on `127.0.0.1:38765`.
3. `managed-bootstrap.js` registers the notifier-created window using the one-time launch token at `document_start`.
4. `state-engine.js` is the deterministic ChatGPT response-state engine with explicit blocker precedence and stable-ended completion.
5. `content.js` observes the live ChatGPT DOM, binds evidence to the current turn, renders the progress overlay and persistent top alert, and performs guarded automatic Resume/Continue-generating submission.
6. `service-worker.js` owns the managed Chrome `windowId`, per-tab records, notification policy, stale-heartbeat detection, exact-tab commands, and timeout-only safe refresh controller.
7. `reliability-core.js` contains shared deterministic lifecycle/state helpers covered by Node tests.

## v2.4.0 progress and current-task flow

The release root exposes exactly one user-facing BAT launcher: `START_CHATGPT_WORK_NOTIFIER.bat`. It starts and verifies Advanced Logger, which then invokes the notifier-only wrapper under `Maintenance`. Potentially destructive or specialist BAT commands are isolated under `Maintenance`; Windows startup continues to use the direct hidden VBS/PowerShell runtime path.

`content.js` resolves the latest active assistant turn before using the authoritative state-engine percentage parser. The full turn text is primary because ChatGPT can render streaming commentary as a sibling of its final assistant-role child; the scoped child is the fallback. This prevents hidden/auxiliary assistant nodes and split streaming markup from masking visible progress. It resolves the tab title from the selected sidebar conversation link whose path matches the current URL, falling back to the browser title only when that entry is unavailable. It sends `title`, `progress`, `safeCompletion`, and message identity on its 20-second heartbeat. The service worker stores those fields per tab, preserves sidebar-derived titles during scans, and forwards them to the bridge. Non-`COMPLETE` states clear completion proof; an unsafe heartbeat claiming `COMPLETE` is downgraded to `UNCERTAIN`. Heartbeats never create transition events or notifications merely because progress changed, and a recovered non-manual heartbeat clears stale manual attention.

The bridge has one strict validator shared by browser events and heartbeats. Only `null` or a finite JSON numeric primitive in the inclusive 0–100 range is accepted. Public `/state` adds progress, update freshness, and proof but retains title/URL/conversation privacy. Authenticated local `POST /dashboard-state` adds a bounded sanitized title for native display.

The tray host uses one `Select-CurrentTask` function for both dashboard and tray presentation. Eligible tabs are ranked manual-action, then running, then other managed state; newest `updatedAt` and highest numeric tab ID resolve ties. The compact 860x700 WinForms dashboard opens on **Tasks** with the current-task and flexible all-tab progress surfaces plus an aligned bottom row for **Show Chrome**, **Hide Chrome**, and **Hide UI to tray**. Settings, repair, restart, diagnostics, and extension setup are isolated on **Controls**; the full health grid is isolated on **Reliability** and continues updating in the background. A scrollable per-tab panel maintains one cached custom row per eligible tab, updates rows in numeric tab order, and disposes rows when tabs leave the managed set. Every row has an independent title, state, percentage, bar, and freshness. The first tray item and bounded 63-character tooltip reflect the selected task.

## Completion state machine

The content layer snapshots the latest user message, latest assistant turn, latest final assistant message, Stop/Continue controls, visible Thinking state, current-turn Worked-for duration, error text, composer contents, and response stability.

For a genuinely observed generation, strong explicit completion or ChatGPT's finalized response action row can qualify immediately after the stability window. A normally ended assistant response also qualifies after eight stable seconds when no blocker is present; no semantic completion phrase is required. Blockers always win: timeout, explicit partial progress, Continue-generating, direct assistant-task incomplete language, a long stopped response, visible stuck Thinking, a new unanswered user prompt, or waiting-input cues prevent completion.

The service worker independently rejects any incoming `COMPLETE` event without `safeCompletion=true` and converts it to `UNCERTAIN`.

## Pause and stuck-Thinking recovery

Partial progress or a stopped current response at/after 24m30s without strong completion becomes `PAUSED`. A visible Thinking indicator that remains unchanged for two minutes without an active Stop control becomes `STUCK_THINKING`.

Partial-progress, incomplete-text, and Continue-generating pauses require `generationObserved=true` and eight stable seconds. Historical response DOM may be displayed but cannot recreate a Resume incident after completion or reload. Continue-generating is searched only inside the current assistant turn. Active-turn text preserves line boundaries so line-leading percentage headings remain authoritative.

`content.js` establishes a signature for the latest user message at startup and after terminal completion. `awaitingAssistant` requires a different signature, so transient historical user-before-assistant hydration order cannot create a new run or unlock historical pause evidence.

For those two states only, `content.js` may write exactly `Resume` into an empty composer. It records ownership of that prefill so later scans do not mistake it for an unrelated user draft. With autopilot enabled (the default), it submits exactly that owned Resume draft using the enabled Send control, or clicks the current turn’s Continue generating control with an empty composer. A fresh worker permission check verifies the live managed tab, enabled settings and bridge health. The per-incident session journal prevents duplicate sends; input requests and drafts block autopilot.

## Persistent alert channel

Only states that genuinely require the user (`PAUSED`, `STUCK_THINKING`, `WAITING_INPUT`, and `FAILED`) use the safety channel. The page renders a fixed top alert with an incident key. Dismissing an incident prevents heartbeat scans from immediately resurrecting the same alert. A new incident can alert again. The tray popup is TopMost and Chrome notifications request user interaction.

The bridge stores manual popup events in a bounded sequence queue. The tray consumes them in order, so a later incident cannot overwrite an earlier unseen one. Opening the affected tab does not resolve or close the popup; only explicit dismissal or a verified recovery transition does. Recoverable timeout, stale-heartbeat, connection, and monitoring faults are recorded as operational telemetry and repaired quietly; they do not create manual-verification popups.

## Timeout-only page refresh

Only an explicit `TIMEOUT` can schedule automatic page recovery. The service worker queues one alarm per tab, waits about 12 seconds, and re-probes the live content script before reload.

The reload is cancelled if the timeout has cleared, Stop/Continue is present, the composer contains text, the tab is no longer ChatGPT, or the conversation identity changed. A real reload uses `bypassCache:false`, has a 15-minute global cooldown, and is limited to four attempts per rolling six-hour window. A post-reload verification alarm raises `RECOVERY_FAILED` if timeout persists.

Generic stale heartbeat and connection faults stay in diagnostics while the native repair controller works automatically. Paused, stuck-Thinking, and waiting-input content still requires the user because automatically submitting ChatGPT text is deliberately prohibited.

## Original-profile, single-window boundary

The tray host launches Chrome with the user's selected existing `--profile-directory` and a new tokenized ChatGPT window. It does not set `--user-data-dir`. The newly appearing top-level HWND and registered Chrome `windowId` define the management boundary.

Ordinary Chrome windows are ignored even if they share the same process and profile. The notifier never terminates `chrome.exe`.

Recovery scans reconcile the managed record set with the current ChatGPT tabs and remove records whose tabs navigated elsewhere. If the captured HWND disappears while any managed tab reports `RUNNING`, native window recreation is suppressed and health becomes `DEGRADED`; automatic recreation is allowed only when no active work is reported.

## Power and persistence

While monitoring and computer-awake are enabled, the tray host uses `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)`. Display-awake is optional. Lid-close policy is untouched.

Runtime settings, bridge state, logs, PID files, and managed-window state live under `%LOCALAPPDATA%\ChatGPT Work Notifier`. Chrome profile data remains in Chrome's own user-data directory.

## Historical v2.3.0 positive RUNNING evidence retained

The page classifier now records three independent positive activity signals: the native Stop control, the platform extended-thinking banner (`Our systems are thinking a bit more about this request before responding`), and current-turn tool-status activity such as `Inspecting Tests and Static Audits`. The exact platform banner is sufficient to keep the state `RUNNING`; active tool text is supporting telemetry and strengthens the Stop-control path, but historical tool text by itself never creates a fresh run. These signals are part of the current-turn fingerprint, so changing tool activity resets stability timing rather than being misread as a frozen response.

The platform-banner detector ignores matching text inside actual user/assistant message bodies, so discussing or quoting the banner cannot manufacture a RUNNING state. Explicit timeout/error evidence still has higher priority than RUNNING indicators. The notifier therefore cannot hide a genuine `TIMEOUT` merely because stale activity markup remains in the DOM.

## v2.2.1 persistent manual-attention lifecycle

Manual-action state is treated as an incident, not a transient toast. A page-level incident can originate from the DOM classifier or from the background health/recovery path. Background incidents are cleared only by an explicit recovery transition, not merely because the current DOM classifier happens to report a different ordinary state. The Windows TopMost popup keeps an unresolved manual incident visible when the user opens the affected tab; later manual incidents are queued instead of replacing it. The popup closes automatically once the bridge reports that the affected tab has left all manual-action states, or when the user explicitly dismisses it.

Explicit progress expressions such as `75% complete` or `Progress: 75%` outrank generic percentages in unrelated metrics. Completion language is also checked for negation before the fail-closed completion gate can pass.

## v2.2.1 completion refinement (superseded in v2.4.0)

The earlier work-like semantic-proof rule was superseded because it produced false manual-verification prompts for normally finished answers. Current v2.4.0 behavior accepts a stable ended response from an observed run when every explicit blocker is absent. Historical DOM remains non-authoritative for new completion events, and only explicit task-progress markers feed authoritative percentage state; generic numerical percentages are ignored.

Progress estimates are applied after classification, never as state-engine evidence. `progressEstimated` travels with STATE and HEARTBEAT through worker storage and the bridge to each UI. Only an observed run without reported progress uses elapsed / 26 minutes, capped at 100%; estimated 100% remains RUNNING until actual completion.
