# HISTORICAL STAGE-1 WINDOWS EXECUTION REPORT — v2.3.0

This report is preserved as evidence of the v2.3.0 Windows/Chrome run. It has not been relabelled as newly executed against v2.4.0.

## Current status

**FAIL / NOT FINAL — Phase E packaging is blocked by required unexecuted Phase D rows.**

Windows 11 execution was performed on 3–4 September 2026 against the single release root `<release-root>`. Source and runtime defects exposed during the run were repaired and their applicable phases were restarted. The release must not be packaged or labelled final until every remaining required live row below passes.

## Phase A — source gate

Latest complete source validation result (runner now located at `Maintenance\RUN_CODEX_FINAL_WINDOWS_VALIDATION.bat`):

- JavaScript syntax and all four Node suites: PASS.
- `security-hardening-v230.py`: **37/37 PASS**.
- Expanded static audit: **263/263 PASS**.
- Material audit: **100/100 PASS**.
- Windows PowerShell 5.1 parser gate: PASS for every `.ps1` file.

## Phase B/C — installed Windows runtime

The exact root was installed and launched repeatedly after each source repair. Latest post-sleep evidence:

| Evidence | Result |
|---|---|
| `CODEX_RUNTIME_VERIFICATION.json` | 23 checks, 0 required failures, overall PASS; generated `2026-09-04T00:49:24.4907040Z` |
| `CODEX_SECURITY_RUNTIME.json` | 8/8 PASS; generated `2026-09-04T00:49:29.3442850Z` |
| `CODEX_DIAGNOSTICS.txt` | 15 PASS, 1 permitted user-visual WARN, 0 FAIL |
| Advanced Logger | Logger 1.1.1 recorder alive; session `20260904T004712Z_24932`; 0 logger errors after 12-second live retest |
| Controller uniqueness after sleep/wake | 1 tray, 1 bridge, 1 recorder |
| Post-wake state | bridge online, 1 tracked/protected tab, 9.7-second heartbeat at the final diagnostic, Chrome alive, `HEALTHY` |

The logger retest also confirmed that privacy-redacted bridge state no longer produces missing-property errors, .NET SHA-256 integrity checks return real hashes, and an empty Windows event query is not misreported as a logger fault. Its current source-integrity mismatch is expected until the prohibited Phase E hash regeneration occurs.

## Phase D — actual live evidence

| Gate | Result | Actual observation |
|---|---|---|
| Original Chrome identity | PASS | Runtime used existing `Default` profile and signed-in Chrome session; no copied profile. |
| Ordinary-window isolation | PASS | Ordinary YouTube Chrome HWND 265558 remained alive and visible through managed-window loss, stale-HWND attack, upgrade, and uninstall. |
| Visible/minimized/hidden monitoring | PASS | Real response transitions and heartbeats continued; hidden final run produced `UNCERTAIN` then safe `COMPLETE` and a user-confirmed bottom-right popup. |
| Exact-tab routing | PASS | Command channel activated tab 628227358; popup targeted 628227408; user confirmed the second/right tab opened. |
| Multiple conversations/concurrent delivery | PASS | 5 and 10 independent tracked tabs were observed; two injected manual incidents queued in order and the user saw both notifications. |
| Safe completion gate | PASS | Bare/unsafe completion is covered by the service-worker regression and live work-like completion produced `UNCERTAIN` before safe `COMPLETE`. |
| Persistent desktop/open-tab alert | PASS | After Open was clicked, Win32 enumeration found the popup still visible and TopMost at bottom right (`1330,748–1893,993`); it closed only after Dismiss/recovery. |
| Generic stale heartbeat | PASS | Disabling the extension produced 76.8-second stale heartbeat, `DEGRADED`, and one `PAGE_STALE` popup without repeated spam. |
| Bridge loss/recovery | PASS | Killing bridge produced `CONNECTION_LOST`; replacement PID started; `MONITORING_RECOVERED` followed; no false completion. |
| Managed-window loss while idle | PASS | Old HWND closed; one replacement was captured after the bounded 28-second window; fresh heartbeat returned; ordinary Chrome survived. |
| Running-work protection | PASS | Controlled RUNNING state plus native managed-window loss produced `DEGRADED`; no replacement appeared during two recovery cycles; suppression logged twice. |
| Power and sleep/wake | PASS | Computer-awake ON, display-awake OFF; after real sleep/wake there was one authoritative controller, fresh heartbeat, and `HEALTHY`. |
| Uninstall boundary | PASS | Managed HWND closed, tray/bridge stopped, startup value removed; ordinary Chrome HWND stayed alive and visible. |
| Ambiguous concurrent Chrome capture | PASS | Live concurrent-window attack failed closed rather than claiming an ambiguous HWND. |
| Token/origin spoof attacks | PASS | No-origin and wrong-token browser writes plus unauthenticated controls were rejected; 8/8 security runtime checks pass. |
| String-boolean settings attack | PASS | All seven malformed string values were ignored and logged; typed safe defaults remained; original settings restored byte-identically. |
| Atomic JSON read/write stress | PASS with limitation | 5,744 successful reads, 19 transient open/parse retries, 0 missing files, and no corrupt committed JSON; an exactly timed process interruption during the replace syscall was not independently observed. |
| Non-Chrome persisted HWND | PASS | Persisted HWND was replaced with visible Notepad HWND 2885802; uninstall rejected it and left Notepad alive/visible. |
| Unrelated same-name PowerShell process | PASS | External temporary `tray-host.ps1` PID 33852 survived upgrade; exact PID was then stopped and its temporary directory removed. |
| Stale tab-count recovery | PASS | A tab changed to `chrome://extensions` while disabled remained falsely counted; repaired recovery scan pruned it live, leaving exactly 2 real ChatGPT tabs, both protected. |

## Resource matrix

Chrome memory is excluded by design; values below measure notifier PowerShell processes.

| Tracked tabs | Result | Tray | Bridge |
|---:|---|---|---|
| 1 | PASS | 124.9 MB, 0.10% CPU | 87.7 MB, 0.00% CPU |
| 5 | PASS | 127.2 MB, 0.23% CPU | 88.1 MB, 0.14% CPU |
| 10 | PASS | 129.7 MB, 0.10% CPU | 88.2 MB, 0.06% CPU |
| 20 | **NOT EXECUTED** | User explicitly instructed: “do not do any more tabs after this” at 10 tabs. | Required row remains open. |

## Required rows still open

The following behaviors have deterministic Node/static coverage but were not exercised as live DOM states inside a managed ChatGPT page, so they are not promoted to live PASS:

- startup with an already-present PAUSED/TIMEOUT/STUCK_THINKING fault;
- explicit progress-contamination and negated-completion fixtures;
- explicit TIMEOUT, 25–26 minute PAUSED, and STUCK_THINKING DOM fixtures;
- Resume prefill, existing-draft protection, and persistent in-page action bar;
- timeout delayed refresh recheck, Stop/Continue block, draft block, conversation-scope block, and rate limit;
- the exact extended-thinking banner and active-tool positive-RUNNING indicators;
- the 20-tab resource row;
- a clean Windows user/VM run and both required fresh-extraction repeats.

The reported “computer restart” did not produce a new boot or login after installation: Windows reported boot `2026-08-30 16:08:33` and Explorer start `2026-09-03 18:42:12`, before the startup entry was installed. Therefore startup-at-login remains unexercised rather than failed.

## Phase E

**NOT STARTED.** Hash regeneration, ZIP packaging, two clean extractions, repeated Phase A/C, strongest Phase D repeats, and byte-identical artifact confirmation are prohibited until all required Phase D rows pass.

## Strict release decision

**FAIL / NOT FINAL / DO NOT DISTRIBUTE AS FINAL.** This is driven by explicit remaining evidence gaps, not by a known failing current source gate or runtime gate.
