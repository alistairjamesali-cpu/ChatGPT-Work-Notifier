# REQUIREMENT → IMPLEMENTATION → TEST TRACEABILITY — v2.4.0

| Requirement | Implementation | Primary evidence |
|---|---|---|
| Seamless stable-ended completion with explicit blocker precedence | `state-engine.js`, `content.js` | `state-engine-v221.test.js`, `request-regression-v221.test.js`, `v240-repair-regression.test.js` |
| Extended-thinking/tool RUNNING recognition | `state-engine.js`, `content.js` | state-engine/request regression suites |
| Managed Chrome window only | `runtime/tray-host.ps1`, `service-worker.js` | multi-tab suite, static audit, Windows verifier |
| Existing Chrome profile; no copied profile | `runtime/tray-host.ps1`, `runtime/chrome-launch.json` | static audit + Windows verifier |
| Browser bridge only on loopback | `runtime/browser-bridge.ps1` | static audit + Windows security runtime gate |
| Browser-write authentication | `managed-bootstrap.js`, `service-worker.js`, `runtime/browser-bridge.ps1` | `security-hardening-v230.py`, multi-tab suite, `SECURITY_WINDOWS_RUNTIME.ps1` |
| Persistent manual-action notification | `service-worker.js`, `runtime/tray-host.ps1` | static audit + manual validation |
| Recoverable monitoring faults repair quietly without verification popups | `service-worker.js`, `runtime/tray-host.ps1`, `content.js` | service-worker regression + static/material audits |
| Lossless ordered popup delivery and exact-tab routing | `service-worker.js`, `runtime/browser-bridge.ps1`, `runtime/tray-host.ps1` | request regression + live concurrent-popup/routing validation |
| Stale tab-record pruning | `service-worker.js` | multi-tab suite + live navigate-away recovery validation |
| No managed-window recreation during active work | `runtime/tray-host.ps1` | request regression + live RUNNING window-loss validation |
| Resume prefill never auto-sends | `content.js`, `service-worker.js` | request regression + manual validation |
| Safe TIMEOUT-only recovery | `content.js`, `service-worker.js` | static audit, request regression, manual validation |
| Atomic persistent state | `runtime/tray-host.ps1` | security-hardening gate + Windows fault-injection handoff |
| No stale-HWND takeover | `runtime/tray-host.ps1`, `runtime/uninstall.ps1` | security-hardening gate + Windows verifier |
| Diagnostics sufficient for Codex | `ADVANCED_LOGGER/*`, `runtime/diagnostics.ps1` | static audit + Codex runtime workflow |
| Release reproducibility/identity | `runtime/regenerate-hashes.ps1`, `runtime/package-release.ps1` | final manifest + sidecar verification |
| One obvious root launcher with diagnostics enabled | `START_CHATGPT_WORK_NOTIFIER.bat`, `ADVANCED_LOGGER/start-advanced-logger.ps1`; specialist BATs under `Maintenance` | v2.4.0 matrix + static/material audits + live launcher check |
| Strict 0–100/null progress ingress | `runtime/browser-bridge.ps1` shared validator | `v240-repair-regression.test.js`, security/static audits |
| Visible progress belongs to active assistant turn, including split commentary markup | `assistantForTurn` + `assistantTextForTurn` in `content.js` | executed helper regressions + v2.4.0 matrix + static/material audits |
| Tab name matches current ChatGPT sidebar conversation | `titleFromCurrentConversationLinks` in `content.js`; scan preservation in `service-worker.js` | request regression + v2.4.0 matrix + static/material audits |
| Finalized answers do not falsely request Resume | finalized response controls + scoped incomplete-language rules in `content.js`/`state-engine.js`; heartbeat recovery clear in `service-worker.js` | exact-text request regression + v2.4.0 matrix + static/material audits |
| Historical answers never resurrect Resume; pause evidence is stable and current-run scoped | `state-engine.js`; current-turn Continue detection in `content.js` | state-engine/request regressions + static audit + closed-loop live acceptance |
| Line-leading live progress reaches the dashboard | structured active-turn text in `content.js`; progress transport/bridge/UI | request regression + closed-loop live acceptance |
| Privacy-safe public state and authenticated native titles | `/state`, `POST /dashboard-state` | live isolated bridge contract matrix + security audit |
| Heartbeat progress without alert spam | `content.js`, `service-worker.js`, bridge | multi-tab suite + v2.4.0 matrix |
| Deterministic native current task | `Select-CurrentTask` in `runtime/tray-host.ps1` | `TRAY_SELECTION_TEST.ps1` + static/material audits |
| White/blue native progress UI and bounded tray status | `runtime/tray-host.ps1` | v2.4.0 matrix + static audit |
| Flexible percentage for every managed tab | cached rows in `Update-AllTabProgressPresentation` | `TRAY_PROGRESS_PRESENTATION_TEST.ps1`, request/static/material audits |
| PowerShell 5.1-safe native UI text | ASCII-only `runtime/tray-host.ps1` labels | actual WinForms presentation test + static audit |
| Compact uncluttered UI with separate controls/health | `New-DashboardTabShell`, compact Tasks/Controls/Reliability pages | actual WinForms tab-layout assertions + static/material audits |
| Explicitly hide dashboard without hiding Chrome | `Hide-DashboardUi`, bottom Tasks button, distinct `Hide Chrome` action | actual WinForms visibility/position assertion + static/material audits |
| Unified visibility controls on Tasks | `Move-ChromeButtonsToTasks` | actual WinForms three-button parent/position assertion + static/material audits |
| Bottom-right visual page progress and safe popup completion | `content.js`, `popup.js` | request regression + v2.4.0 matrix |
| Timeout/pause/stuck fixtures retained | `tests/fixtures/*` + state engine | v2.4.0 123-check matrix |
| Cross-folder upgrade launches the current release safely | `runtime/install.ps1`, `Maintenance/INSTALL_OR_UPGRADE.bat` | `INSTALL_MIGRATION_TEST.ps1`, security/static gates, live installer run |
