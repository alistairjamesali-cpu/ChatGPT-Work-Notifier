# MAXIMUM-STRENGTH AUDIT / REPAIR REPORT — v2.3.0

## 1. FINAL STATUS

**STRICT Audit.md status: FAIL / NOT FINAL — solely because Windows/Chrome E4/E5 execution was explicitly excluded by the user and is delegated to Codex.**

**Portable/static repair scope: 100% complete.** No known repairable CRITICAL or HIGH defect remains in that scope. Do not convert the strict release status to PASS until Codex executes the exact Windows artifact and the fresh-repeat gates in `CODEX_FINALISE_NO_THINKING.md`.

## 2. FILE COVERAGE

- Supplied release: **65 files**.
- Repaired candidate before this report: **77 files**.
- Added evidence/test files: **12** plus this report.
- Removed files: **0**.
- Modified vs supplied archive: **40** (many include the intentional v2.3.0 release identity update).
- Unchanged vs supplied archive: **25**.
- Every shipped text/code/config/document file was included in the line-by-line portable material audit. Binary icons/ICO were integrity/inventory checked rather than text-decoded.

## 3. EXECUTED TEST COVERAGE

- JavaScript syntax: **PASS** on all six live JS entry files.
- State-engine test: **PASS**.
- Request-regression test: **PASS**.
- Reliability-core test: **PASS**.
- Multi-tab/service-worker test: **PASS**, including forged well-formed managed-token rejection.
- Dedicated security hardening: **37/37 PASS**.
- Expanded static audit: **full PASS** (regenerated again before final packaging).
- Material 100-point source audit: **100/100 PASS** (regenerated again before final packaging).
- Supplied ZIP SHA-256: matched sidecar.
- ZIP traversal/absolute/reserved-name/normalization/case-collision checks: **PASS**.

Windows PowerShell parsing, installer/runtime/UI, sleep/wake, process kill/recovery, real notification persistence, Windows ACL/UAC, soak/resource/performance and exact Windows artifact execution were **not executed here by explicit scope**.

## 4. MATERIAL DEFECTS REPAIRED

See `DEFECT_REPAIR_LEDGER.json` for root cause/retest detail. The repaired set includes:

- unauthenticated browser heartbeat/event spoofing;
- unvalidated managed-window token registration;
- session-token leakage through URL history/logging/process arguments;
- stale/reused HWND potentially targeting a non-Chrome window;
- PATH/search-order executable ambiguity;
- string-to-boolean configuration coercion;
- non-atomic critical JSON persistence;
- ambiguous concurrent Chrome-window ownership capture;
- over-broad upgrade/uninstall process termination;
- malformed tab-close false-success response;
- unauthenticated public bridge exposure of ChatGPT URL/conversation metadata;
- diagnostics not matching the hardened IPC contract;
- unauthenticated local repair/focus/diagnostic control-plane actions.

## 5. SILENT-FAILURE / FALSE-SUCCESS EMPHASIS

The most important repaired silent-failure route was spoofable browser health: a local process could previously make the bridge appear recently alive without proving the real extension/session produced the signal. Browser-originated health/event writes now require the active managed-session token plus extension Origin. The local state-changing control plane also requires the session token.

Completion logic remains fail-closed. The existing regression corpus for TIMEOUT, PAUSED, STUCK_THINKING, UNCERTAIN, stale heartbeat, historical DOM, unrelated 100% metrics, draft-protected recovery, and no-auto-send behavior remains passing.

## 6. RELEASE / SUPPLY-CHAIN EVIDENCE

Included:

- `AUDIT_100_LAYER_RESULTS.md`
- `DEFECT_REPAIR_LEDGER.json`
- `REQUIREMENT_TRACEABILITY.md`
- `CRITICAL_INVARIANTS.md`
- `TEST_EVIDENCE_INDEX.md`
- `FINAL_ENVIRONMENT_MATRIX.md`
- `SBOM.cdx.json`
- `BUILD_PROVENANCE.json`
- `SECURITY_BASELINE.md`
- `CODEX_FINALISE_NO_THINKING.md`
- `tests/security-hardening-v230.py`
- `tests/SECURITY_WINDOWS_RUNTIME.ps1`

## 7. CODEX FINALISATION CONTRACT

Codex does **not** need to design the repair. It should follow `CODEX_FINALISE_NO_THINKING.md` in order: source gate → install/launch → automated runtime/security gates → exact manual/adversarial rows → package → fresh extraction/repeat twice → hash lock → final report.

Any actual Windows failure remains a real failure until repaired and the full affected gate sequence is rerun.
