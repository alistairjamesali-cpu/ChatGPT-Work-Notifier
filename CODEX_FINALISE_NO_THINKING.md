# CODEX — VERIFY AND FINALISE v2.4.0 IN PLACE

## Source gate

Run from this exact root:

```bat
Maintenance\RUN_CODEX_FINAL_WINDOWS_VALIDATION.bat
```

Every JavaScript, runtime-contract, selector, security, static, material, and PowerShell parser gate must pass. If code/configuration changes after a failure, rerun the complete gate.

## Evidence and integrity

1. Preserve `FINAL_WINDOWS_EXECUTION_REPORT.md`, `CODEX_RUNTIME_VERIFICATION.json`, `CODEX_SECURITY_RUNTIME.json`, `CODEX_DIAGNOSTICS.txt`, and other Stage-1 results as historical v2.3.0 evidence.
2. Record v2.4.0 source/runtime-contract evidence separately in `V240_IMPLEMENTATION_EVIDENCE.md` and `FINAL_V240_VERIFICATION.md`.
3. Regenerate current-release hashes with `runtime\regenerate-hashes.ps1` only after implementation and documentation are stable.
4. Generate `ROOT_FILE_MANIFEST_V240.tsv` with relative path, byte size, and SHA-256 for every release-significant file.
5. Run the complete source gate twice against the final root. If anything except generated evidence changes, regenerate hashes and repeat affected gates.

## Optional live Windows follow-up

Installation/runtime checks may be run with `Maintenance\INSTALL_OR_UPGRADE.bat`, `Maintenance\LAUNCH_NOTIFIER_ONLY.bat`, `tests\VERIFY_RUNTIME.ps1`, `tests\SECURITY_WINDOWS_RUNTIME.ps1`, `runtime\diagnostics.ps1`, and `tests\MANUAL_VALIDATION.md`. Normal user startup is the sole root BAT, `START_CHATGPT_WORK_NOTIFIER.bat`, which includes Advanced Logger. Do not claim a new live observation unless it occurred. Existing Stage-1 live evidence remains the accepted historical baseline for this source implementation handoff.

## Boundaries

Do not package a ZIP, create a second implementation root, modify Chrome profile data, or disturb ordinary Chrome windows. Completion means the repaired v2.4.0 program and its final evidence remain in this root with two clean validation passes.
