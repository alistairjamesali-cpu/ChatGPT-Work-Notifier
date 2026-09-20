# v2.4.0 Implementation Evidence

Date: 2026-09-04

Authoritative root: `CURRENT_NOTIFIER/Notifier`

Input ZIP SHA-256: `20cc4a6f15a631940c00eaa005b08dac3cd220936cdd73bb807c2e6542c376ef`

Verified baseline root-manifest SHA-256: `1b28dd3860d4e68e9f629655f3f510e28c5e5a546af6088b23e100d5e75e69f8`

## Implemented repair

- One shared bridge progress validator accepts only `null` or finite JSON numeric primitives in 0–100 and rejects every malformed/out-of-range write with HTTP 400.
- Per-tab bridge state now stores title, progress, `updatedAt`, and `safeCompletion`; public state remains title/URL/conversation-redacted and authenticated `POST /dashboard-state` exposes only a sanitized title.
- Content/service heartbeats transport title, progress, proof, and message identity. Unsafe COMPLETE is downgraded and terminal percentage suppressed; non-COMPLETE clears old proof. Progress-only heartbeats do not add events or notifications.
- Visible progress is now read from the entire active assistant turn, covering streaming commentary rendered outside the final assistant-role child; the scoped child remains the fallback, and a later hidden/auxiliary node cannot mask the turn text.
- Each heartbeat title is resolved from the selected ChatGPT sidebar conversation link matching the current URL; the service worker preserves that title during periodic scans.
- ChatGPT's finalized response action row now provides stable completion evidence for an observed run. Broad subject-matter phrases such as “the program code still needs” no longer manufacture `PAUSED`; explicit task-incomplete language, partial progress, and Continue-generating remain fail-closed. Recovered heartbeats clear stale manual attention.
- One native `Select-CurrentTask` ranks manual-action states, RUNNING, then other managed states, with newest freshness and highest numeric tab ID tie-breaks. Detached/closed/pruned records are excluded.
- The compact 860x700 Windows dashboard opens on an uncluttered Tasks tab containing a white/blue CURRENT CHATGPT TASK panel plus a flexible scrollable list showing independent title/state/percentage/bar/freshness for every eligible managed tab. Show Chrome, Hide Chrome, and Hide UI to tray occupy one aligned bottom row in the marked Tasks area. Settings and secondary repair/restart/diagnostics/setup actions are isolated on Controls, and the detailed health grid is isolated on Reliability while continuing to update. Rows are cached, updated, and removed with tab lifecycle. The disabled first tray item and bounded 63-character tooltip use the selected task.
- The existing bottom-right page monitor is now a structured visual bar. Chrome popup rendering also requires completion proof before COMPLETE/100.
- TIMEOUT, 25m47s/75% PAUSED, and STUCK_THINKING fixtures are copied into the test tree and exercised directly.
- Cross-folder upgrade now validates prior notifier identity from its manifest and runtime files before stopping it, preventing an older release from retaining the product-wide mutex without broad process termination. The installer batch also uses a console-safe success delay.
- Native dashboard/tray text is ASCII-safe for Windows PowerShell 5.1; no-value progress now renders as `N/A` instead of a corrupted Unicode dash.
- The root contains exactly one BAT, `START_CHATGPT_WORK_NOTIFIER.bat`. It verifies Advanced Logger startup before launching the notifier; install, uninstall, source validation, diagnostic packaging, logger control, and notifier-only wrappers are isolated under `Maintenance`.
- Stable ended responses from an observed run now become proof-backed `COMPLETE` after eight seconds whenever all explicit blockers are absent. Routine completion no longer degrades to `UNCERTAIN` or asks the user to verify it manually.
- Persistent alerts are limited to genuine user-action states. Timeout, stale heartbeat, connection loss, recovery failure, and internal unsafe-state telemetry are handled quietly by the automatic recovery controller and Advanced Logger.
- Historical incomplete wording and partial percentages can no longer resurrect `PAUSED`; semantic/percentage pause evidence requires a currently observed run plus eight stable seconds. Continue-generating is current-turn scoped, and preserved line boundaries allow `30% — ...` progress headings to reach every UI surface.
- Startup/terminal user-message signatures prevent transient ChatGPT hydration order from treating an already answered historical prompt as a newly submitted run.

## Deterministic evidence

- `tests/v240-repair-regression.test.js`: 123 checks PASS. This verifies the one-launcher root and maintenance isolation, launches the actual bridge on an isolated loopback port/runtime directory, and verifies authentication, strict progress types/bounds, active-turn container/commentary progress binding, selected-sidebar titles, finalized/stable-ended response proof, false-pause prevention, quiet stale recovery, recovered-attention clearing, privacy, sanitized title, progress-only behavior, completion proof, and per-tab dashboard contracts.
- `tests/TRAY_SELECTION_TEST.ps1`: extracts and executes the real selector function; manual priority, newest-within-rank, tab-ID tie, detached exclusion, RUNNING priority, and empty state PASS.
- `tests/TRAY_PROGRESS_PRESENTATION_TEST.ps1`: extracts and executes the actual WinForms tab shell, dashboard-hide function, unified visibility-row placement, and per-tab functions; 20 scenarios PASS, including compact Tasks/Controls/Reliability separation, default selection, explicit UI hiding, aligned task-level visibility controls, independent percentages, unknown progress, completion proof, removal, ordering, and scroll growth through 10 tabs.
- `tests/INSTALL_MIGRATION_TEST.ps1`: extracts and executes the actual installer identity function; five verified/rejected cross-root scenarios PASS.
- `tests/service-worker-multitab.test.js`: heartbeat field forwarding, unsafe completion downgrade, proof reset, new-task percentage reset, no event/notification spam, and existing multi-tab/lifecycle/recovery behavior PASS.
- Existing state-engine, request-regression, reliability-core, security, static, material, and PowerShell parser gates remain required by the final runner.

## Environment

- Windows host
- Node.js v26.3.0
- Python 3.13.5
- Windows PowerShell 5.1.26100.9168
- PowerShell 7.6.5 used for orchestration only

Historical v2.3.0 Stage-1 Windows/Chrome reports were preserved without relabelling. A live installer run on 2026-09-04 completed with exit code 0, opened the responding v2.4.0 dashboard, started the v2.4.0 loopback bridge, and reported one connected managed tab. No new dashboard screenshot was claimed, and no replacement ZIP or duplicate implementation root was created.
