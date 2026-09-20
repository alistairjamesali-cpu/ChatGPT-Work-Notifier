# CRITICAL INVARIANTS — v2.4.0

1. **No false completion or manual-verification chore.** COMPLETE requires `safeCompletion` evidence from an observed response that ended stably with every explicit blocker absent.
2. **No spoofed health.** Browser-originated event/heartbeat/command-write traffic requires the active session token and Chrome-extension Origin.
3. **No arbitrary managed-window registration.** Registration commits only after bridge token validation.
4. **No unrelated Chrome control.** Every restored/used persisted HWND must still be a Chrome top-level window owned by chrome.exe.
5. **No concurrent-window ownership guess.** More than one newly observed Chrome window causes managed capture to fail closed.
6. **No broad process kill.** Tray/bridge termination is scoped to the exact release root; chrome.exe is never killed.
7. **No partial critical JSON presented as committed.** Managed state, settings and runtime state use atomic replacement.
8. **No session secret in user-facing URL history, tray logs, or bridge process command line.**
9. **No PATH-based production browser/PowerShell/WSH resolution.** Explicit trusted locations are required.
10. **No silent genuine user-action condition.** PAUSED, STUCK_THINKING, WAITING_INPUT, and FAILED remain persistent/topmost until resolved/dismissed; recoverable monitoring faults stay quiet and self-repairing.
11. **No unsafe timeout reload.** Reload is TIMEOUT-only, live-reprobed, draft/conversation protected, and rate-limited.
12. **No unlabelled estimated progress.** Progress is `null` or a finite numeric primitive in 0–100; invalid browser writes fail with HTTP 400. The user-requested 26-minute fallback is labelled estimated and never used as completion evidence.
13. **No unsafe native completion.** Page, popup, bridge, dashboard, and tray show terminal COMPLETE/100 only with retained `safeCompletion=true`.
14. **One deterministic current task.** Dashboard, tray item, and tooltip use the same selector and exclude detached/closed/pruned tabs.
15. **No progress notification spam.** Percentage-only heartbeats may refresh state/UI but never create transition events or alerts.
16. **No release identity drift.** Active runtime/configuration/documentation is v2.4.0 and the root matches its regenerated SHA-256 manifest.

Each invariant has a positive/negative static or Node gate now. Windows runtime violation attempts are enumerated in `CODEX_FINALISE_NO_THINKING.md`, `tests/VERIFY_RUNTIME.ps1`, `tests/SECURITY_WINDOWS_RUNTIME.ps1`, and `tests/MANUAL_VALIDATION.md`.

17. **Guarded autopilot only.** Automatic submission is restricted to confirmed resumable states in the live managed window; drafts, attachments, active generation, input requests, disabled monitoring and duplicate incidents block submission.
