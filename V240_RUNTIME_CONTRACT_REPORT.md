# v2.4.0 Runtime-Contract Result

Date: 2026-09-04

- `tests/v240-repair-regression.test.js`: 123/123 PASS.
- The test starts the actual `runtime/browser-bridge.ps1` in an isolated temporary runtime directory and loopback port, then removes all temporary state.
- Verified HTTP 400 rejection for string, boolean, array, object, negative, over-100, NaN, infinity, and malformed progress.
- Verified the one-launcher root and maintenance isolation; `null`, 0, 75.5, and 100 progress acceptance; active-turn container/commentary progress binding despite empty or trailing assistant-role nodes; selected-sidebar current-conversation titles; finalized and stable-ended response proof without false Resume or manual verification; quiet stale recovery; stale manual-attention clearing; public privacy; authenticated sanitized title; heartbeat freshness/progress; no heartbeat event/popup manufacturing; unsafe completion downgrade; and safe COMPLETE/100.
- All three supplied DOM fixture families pass: timeout with stale Stop, 25m47s/75% pause, and stuck Thinking.
- `tests/TRAY_SELECTION_TEST.ps1`: PASS for all six actual-selector scenarios.
- `tests/TRAY_PROGRESS_PRESENTATION_TEST.ps1`: PASS for all 20 actual WinForms scenarios, including a flexible 10-tab scroll surface.

This is implementation/runtime-contract evidence. No new live Chrome/dashboard screenshot is claimed.
