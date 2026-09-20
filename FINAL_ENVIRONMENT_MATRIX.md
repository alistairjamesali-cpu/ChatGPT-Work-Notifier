# HISTORICAL STAGE-1 ENVIRONMENT MATRIX — v2.3.0

This file records the version actually exercised during Stage 1. It is preserved as historical evidence and is not a claim of a new v2.4.0 live rerun.

| Environment | Purpose | Result |
|---|---|---|
| Windows 11 target machine + Windows PowerShell 5.1 | Parser, install, tray/bridge, HWND, notification, recovery, sleep/wake, uninstall, security | **PASS for executed rows**; see `FINAL_WINDOWS_EXECUTION_REPORT.md` |
| Google Chrome, existing `Default` profile | Managed-window isolation, real heartbeat, multi-tab, hidden completion, popup routing/persistence | **PASS for executed rows**; live artificial DOM fault matrix remains incomplete |
| 1/5/10 managed ChatGPT tabs | Resource and protection sampling | PASS |
| 20 managed ChatGPT tabs | Required resource sample | **NOT EXECUTED by explicit user limit** |
| Fresh/clean Windows user or disposable VM | Hidden-dependency/clean-machine validation | **NOT EXECUTED** |
| Two fresh ZIP extraction destinations | Reproducible release validation | **NOT EXECUTED; Phase E blocked** |
