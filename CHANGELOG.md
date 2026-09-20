# v2.4.0 — Coherent percentage surfaces

- Fixed stale closed-tab dashboard rows with authenticated, periodic reconciliation against Chrome’s actual managed tabs, including missed removals, renderer replacement, and final-window closure during a bridge outage. Live sender validation rejects late messages from closed or moved tabs. Added worker outage/recovery and live bridge inventory regressions.

- Enabled guarded autopilot by default: automatically use Continue generating or send exactly Resume for confirmed pauses; preserve drafts/input requests and journal submissions to prevent duplicates. Added an extension-popup off switch.
- Added labelled progress estimates when an observed task has no reported percentage: 13 minutes = 50%, 26 minutes = 100%, capped at 100%. Estimates never count as completion evidence.

- Hardened completion retries to respect paused monitoring, work-mode filtering, focus, suppression, and retained safe-completion evidence. Persisted work classification and duration keep retry eligibility consistent after worker suspension.
- Scoped delayed delivery acknowledgements to their original episode and made successful delivery monotonic, so an older request cannot mark a newer task notified or reopen an already delivered alert.
- Added episode/outbox regression coverage to the standard Windows source-validation command.

- Made safe terminal delivery acknowledgement-gated with bounded retries, preventing a lost `COMPLETE` event from collapsing into `RUNNING → IDLE`; stale completion notification markers are cleared when a new run starts or a focused completion suppresses the desktop popup.
- Added strict shared bridge validation for `null` or finite numeric 0–100 progress, rejecting malformed writes with HTTP 400.
- Added privacy-safe progress/freshness/proof to public state and authenticated title access through `POST /dashboard-state`.
- Forwarded title, progress, completion proof, and message identity through heartbeats without notification events.
- Added deterministic manual-first/native current-task selection with freshness and tab-ID tie-breaking.
- Added a white/blue Windows CURRENT CHATGPT TASK panel, tray status item, and bounded dynamic tooltip.
- Added a flexible scrollable ALL MANAGED CHATGPT TABS panel with independent percentage bars and freshness for every eligible tab.
- Upgraded the bottom-right page monitor to a real visual progress component and hardened popup COMPLETE/100 proof gating.
- Added a 123-check v2.4.0 runtime-contract matrix, actual selector tests, seamless-completion/quiet-recovery checks, and direct regression coverage for all three supplied DOM fixtures.
- Repaired cross-folder upgrades: the installer now verifies and stops a prior notifier release that could otherwise retain the product mutex, while rejecting unrelated processes. The batch success delay also completes without a misleading console redirection error.
- Replaced Unicode dashboard/tray punctuation with encoding-safe text so Windows PowerShell 5.1 displays `N/A` and separators correctly instead of mojibake such as `â€”`.
- Moved the full Background Reliability grid into a dedicated `Reliability` tab; the default `Tasks` tab now keeps progress, settings, and quick actions visible without the health grid clutter.
- Compacted the dashboard to 860x700, moved settings/actions into a dedicated `Controls` tab, added an explicit `Hide UI to tray` action, and renamed the managed-window action to `Hide Chrome` to remove ambiguity.
- Moved the primary `Show Chrome` and `Hide Chrome` buttons from Controls to the marked bottom area of Tasks; repair/restart/diagnostics/setup remain on Controls.
- Moved `Hide UI to tray` from the header into the third position of the same bottom Tasks visibility row.
- Fixed visible progress such as `65% complete` being missed when ChatGPT appends a hidden or auxiliary assistant-role node after the active streaming turn; progress extraction is now scoped directly to the latest assistant turn.
- Changed each monitored tab title to the selected ChatGPT sidebar conversation name matching that tab's current URL; periodic worker scans preserve this precise title.
- Fixed false `PAUSED`/Resume alerts on finalized advisory answers that merely describe product code as still needing work. Finalized response controls now provide completion evidence, while explicit partial progress, Continue-generating, and direct statements that the assistant's task remains incomplete still fail closed.
- Clear stale manual-attention state when a normal heartbeat proves that the tab has recovered.
- Cleaned the program root to one obvious user launcher, `START_CHATGPT_WORK_NOTIFIER.bat`, which starts and verifies Advanced Logger before launching the notifier. All install/uninstall/validation/diagnostic and notifier-only BAT files now live under `Maintenance`.
- Routed the installed Windows logon entry through the same Advanced Logger bootstrap, so every normal app start creates or reuses a continuously recording logger session before the notifier launches.
- Fixed visible progress rendered in the active assistant turn container but outside its final assistant-role child; turn-scoped streaming commentary now supplies authoritative percentages such as `30% complete`, with the assistant child retained as fallback.
- Removed false `Verify manually` incidents for normally ended work responses. An observed response now completes after eight stable seconds when no explicit active, paused, waiting, timeout, failure, or incomplete signal exists.
- Restricted persistent user-action alerts to `PAUSED`, `STUCK_THINKING`, `WAITING_INPUT`, and `FAILED`. Timeout, stale-heartbeat, connection, recovery, and internal unsafe-state faults remain quiet while automatic recovery and Advanced Logger diagnostics continue.
- Replaced the tray's stale-heartbeat popup with quiet staged repair logging, preserving automatic connection repair and managed-Chrome recovery without making the user fix monitoring state.
- Prevented completed historical text or a remembered partial percentage from resurrecting `PAUSED` after completion, extension reload, or page restoration. Text/percentage pause evidence now requires an observed current run and eight stable seconds.
- Scoped Continue-generating detection to the current assistant turn and an observed current run, with the same eight-second stability gate, preventing restored or unrelated controls from pre-filling Resume.
- Preserved line boundaries in active-turn text so line-leading progress headings such as `30% — ...` reach the percentage parser and dashboard.
- Bound awaiting-response detection to a latest-user-message signature established at startup, preventing ChatGPT hydration order from misclassifying an already answered historical prompt as a newly observed run.

# Historical v2.3.0 — Maximum audit hardening

- Added authenticated browser↔bridge session channel and pre-registration validation.
- Removed token leakage from URL history/logs/process command line.
- Added Chrome-owned HWND validation and fail-closed concurrent-window capture.
- Added atomic critical JSON state writes and strict boolean configuration typing.
- Removed PATH-based production executable resolution and scoped process cleanup to the exact release root.
- Removed URL/conversation metadata from unauthenticated bridge health state.
- Added 35-point security hardening test and Windows adversarial security runtime gate.
- Added full audit evidence pack and deterministic Codex finalisation contract.
- Made bridge delivery acknowledgement-based so a transient bridge failure retries the same state instead of silently losing it.
- Added a bounded, lossless desktop-popup event queue so concurrent manual-action incidents are shown in order.
- Fixed delayed popup button handlers so Open targets the recorded tab and does not dismiss an unresolved incident.
- Added a one-shot bottom-right `PAGE_STALE` alert when the extension heartbeat expires.
- Pruned tabs that leave ChatGPT from recovery scans, preventing stale records from inflating the monitored-tab count.
- Suppressed automatic managed-window recreation while any managed tab reports `RUNNING`, preventing active-work takeover after native window loss.
- Hardened runtime JSON readers, diagnostics exit status, Chrome capture stability, and Windows validation launchers.
- Updated Advanced Logger 1.1.1 to consume the privacy-redacted public bridge schema without error flooding and fixed its PowerShell 5.1 integrity-failure list conversion.

# Changelog

## v2.3.0 — positive RUNNING signal hardening

- Added explicit detection of the ChatGPT platform banner **“Our systems are thinking a bit more about this request before responding”** as positive evidence that the task is still running.
- Added current-turn tool-status telemetry for active steps such as **“Inspecting Tests and Static Audits”**.
- Bound the new activity evidence into the run fingerprint so changing tool work resets stability timing.
- Kept explicit timeout/error evidence above the new RUNNING indicators, preventing stale activity markup from masking a real failure.
- Added regression coverage proving extended thinking cannot become `STUCK_THINKING`, `PAUSED`, `UNCERTAIN`, or `COMPLETE`, even after the normal stuck threshold.

## v2.2.1 — re-audit hardening

- Prevented historical response DOM from creating a fresh completion/manual alert after extension startup; known timeout/pause/stuck/error signatures are still surfaced.
- Tightened work-like completion: normal stream termination alone is no longer sufficient; strong semantic/progress completion evidence is required or the job becomes `UNCERTAIN` after a short verification window.
- Removed generic bare percentages from authoritative task progress so coverage/pass-rate/accuracy figures cannot create false `PAUSED` or `COMPLETE` states.
- Narrowed incomplete-language matching so documentation about the `Resume` feature does not falsely classify a finished upgrade as paused.
- Propagated progress-only updates and made the popup choose the most recently updated monitored tab, improving multi-tab percentage accuracy.
- Fixed startup suppression of already-present manual-action states.
- Fixed persistent page alerts for background `PAGE_STALE`, `RECOVERY_FAILED`, and `CONNECTION_LOST` incidents.
- Added explicit clear-on-recovery semantics so action bars close when the affected state genuinely resolves.
- Hardened progress parsing so explicit progress markers beat unrelated percentages later in the same response.
- Added negated-completion gates such as `not 100% complete` and `do not treat this as complete`.
- Hardened the TopMost Windows popup: opening the correct tab no longer dismisses an unresolved manual incident, and concurrent manual incidents are queued.
- Added regression coverage and deterministic Codex validation for these repairs.

- Replaced permissive stopped-response completion with a fail-closed completion gate and `safeCompletion` proof.
- Added explicit `PAUSED`, `STUCK_THINKING`, `TIMEOUT`, `UNCERTAIN`, `PAGE_STALE`, and `RECOVERY_FAILED` handling.
- Added exact detection for delivery-timeout failures, partial 25–26 minute pauses, and a current assistant turn stuck on visible Thinking before a final assistant-message node exists.
- Added safe `Resume` prefill for paused/stuck work when the composer is empty; the notifier never submits it or overwrites drafts.
- Added a persistent fixed top page alert plus persistent/manual-action desktop notification routing.
- Made manual-action alerts bypass focus suppression while normal running/idle states remain quiet.
- Added current-state/progress UI and ordered percentage parsing so old or earlier percentages cannot contaminate a newer response.
- Restricted automatic refresh to explicit timeout recovery only.
- Added live-state recheck before reload, draft protection, Stop/Continue protection, conversation scoping, a 15-minute global cooldown, and a maximum of four reloads per six hours.
- Added 90-second stale-heartbeat fail-closed detection and manual recovery alerts.
- Extended tray, loopback bridge, advanced logger, popup, diagnostics, static audit, material audit, and Node tests for the new state model.

## 2.1.1

- Made the product Chrome-only and removed the obsolete ChatGPT Windows app companion and switch test.
- Changed managed browsing to use the user's original Chrome profile and signed-in session.
- Removed the copied-profile bootstrap, isolated user-data directory, and process-wide background switches.
- Restricted monitoring, hide/show, routing, and recovery to one newly captured Chrome window.
- Ensured ordinary Chrome windows are ignored even when they share the same profile and browser process.
- Changed Chrome recovery and uninstall to close only the captured HWND; `chrome.exe` is never terminated.
- Kept per-tab `autoDiscardable=false` protection and independent multi-tab state.
- Added serialized service-worker mutations, tab lifecycle recovery, heartbeat health checks, stale-page safeguards, and notification deduplication.
- Added a localhost-only metadata bridge with origin checks, payload limits, state allowlists, and no external network client.
- Added a white/blue tray dashboard, in-program alerts, exact-tab routing, and custom icons.
- Added Windows awake protection without changing display or lid policy by default.
- Expanded Node, static, PowerShell parser, runtime, diagnostics, resource, recovery, and packaging checks.
- Fixed Windows PowerShell parser compatibility in the switch test before that obsolete native-app path was removed.
- Fixed runtime port detection to use active TCP listeners rather than an unreliable local `Get-NetTCPConnection` result.

## 2.0.0

- Initial Windows notifier release.
