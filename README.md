# ChatGPT Work Notifier v2.4.0

A Windows + Chrome notifier for long-running ChatGPT work. It watches every ChatGPT tab in one dedicated managed Chrome window, tracks progress, recognizes normally ended responses automatically, and alerts only when the response genuinely needs the user.

## Install

For a normal Windows install, use the release installer `ChatGPT-Work-Notifier-Setup-2.4.0.exe`. The GitHub Actions release workflow builds this EXE from `installer/ChatGPTWorkNotifier.iss`.

If you are installing directly from a cloned or downloaded repository, run `installer\Install.cmd`. It installs per-user to `%LOCALAPPDATA%\Programs\ChatGPT Work Notifier`, creates Start-menu shortcuts, registers the existing logon startup entry, and launches the notifier. Administrator rights are not required.

After the first install, if the extension heartbeat is not connected, open `chrome://extensions` in the Chrome profile you use for ChatGPT, enable Developer mode, choose **Load unpacked**, and select `%LOCALAPPDATA%\Programs\ChatGPT Work Notifier`.

For repository publishing and release steps, see `PUBLISHING.md`.

## What v2.4.0 adds

v2.4.0 adds one coherent percentage surface across the managed page, extension popup, authenticated Windows dashboard, tray menu, and bounded tray tooltip. The compact 860x700 Windows dashboard opens on an uncluttered **Tasks** tab. Its bottom edge contains one aligned visibility row: **Show Chrome**, **Hide Chrome**, and **Hide UI to tray**. The last action hides the dashboard without hiding Chrome or stopping monitoring; use the tray menu's **Open Dashboard** command to restore it. Settings, repair, restart, diagnostics, and extension setup are on **Controls**, while the detailed health grid is on **Reliability**. The dashboard selects one current task deterministically: manual-action states first, then `RUNNING`, then other managed states; ties use newest `updatedAt` and highest numeric tab ID. It also shows every eligible managed tab in a flexible, vertically scrollable list with an independent title, state, percentage/bar, and freshness. Each title is taken from the selected ChatGPT sidebar conversation entry matching that tab's current URL, with the browser title used only as fallback. Rows appear and disappear as tabs are opened, closed, detached, or returned. When progress is unavailable for an observed run, a labelled 26-minute time estimate is shown.

For a run observed by the notifier, an assistant response that has stopped changing for eight seconds and has no active, paused, waiting, timeout, failure, or explicit-incomplete signal is accepted as `COMPLETE` with `safeCompletion=true`. It does not require ChatGPT to write a special “100% complete” phrase. Historical response DOM that existed before monitoring started remains display-only and cannot manufacture a fresh completion or alert.

The notifier explicitly distinguishes:

- `RUNNING`
- `COMPLETE`
- `PAUSED`
- `STUCK_THINKING`
- `TIMEOUT`
- `UNCERTAIN`
- `WAITING_INPUT`
- `PAGE_STALE`
- `FAILED`
- `RECOVERY_FAILED`
- `CONNECTION_LOST`

The supplied real failure patterns are covered. An explicit **Message delivery timed out** state cannot become complete. A stopped response around 25–26 minutes with partial progress, such as **Worked for 25m 47s** and **75% complete**, becomes `PAUSED`. A response that remains visibly on **Thinking** with no active Stop control becomes `STUCK_THINKING` after a stable two-minute threshold.

A finalized response action row is accepted as platform completion evidence after the observed answer remains stable. Advisory wording about program code that “still needs” a change therefore does not falsely mean that ChatGPT paused and requires `Resume`. Explicit task-incomplete statements, partial progress below 100%, Continue-generating, waiting-input, timeout, and active-generation signals retain priority and cannot be overridden by the action row.

Resume classification is current-run scoped. Historical incomplete wording, a remembered partial percentage, or a restored Continue-generating control cannot recreate `PAUSED` after the response has completed, after the extension reloads, or after the page is restored. Continue-generating must belong to an observed current assistant turn, and all pause evidence must remain stable for eight seconds before Resume is offered.

At startup, the latest user-message signature is recorded before monitoring begins. ChatGPT rendering that historical user turn before its already completed assistant turn therefore cannot impersonate a newly submitted request during page hydration.

Two additional **positive RUNNING indicators** are now recognized. The platform banner **“Our systems are thinking a bit more about this request before responding”** is treated as authoritative evidence that the request is still alive. Visible active tool work such as **“Inspecting Tests and Static Audits”** is captured as supporting evidence, and a visible Stop control remains a strong RUNNING signal. These signals suppress false `PAUSED`, `STUCK_THINKING`, `UNCERTAIN`, or `COMPLETE` classification while the request is genuinely still processing.

Autopilot is enabled by default for confirmed `PAUSED` or `STUCK_THINKING` states. It clicks the current turn’s Continue generating control, or writes and sends exactly `Resume` when the composer is empty. It checks live managed-window ownership and monitoring settings before sending, preserves drafts and attachments, and does not answer requests for input or approval. Each paused response is submitted at most once, with a per-tab session journal preventing duplicates after extension reloads. Disable **Autopilot** in the extension popup to stop automatic submissions. If ChatGPT does not expose an enabled control or a submission cannot be confirmed, the pause remains visible for manual recovery.

## Persistent manual-action alerts

Only genuine user-action states (`PAUSED`, `STUCK_THINKING`, `WAITING_INPUT`, and `FAILED`) use safety alerts. They are not suppressed merely because the ChatGPT tab is focused.

The managed ChatGPT page receives a fixed top alert bar. The Windows/tray alert is TopMost. The Chrome notification requests interaction. The page alert remains until the condition clears, the required action changes the state, or you explicitly dismiss that incident. If the notifier starts while a manual-action fault is already present, that initial fault is emitted outward rather than silently accepted as baseline. The Windows TopMost popup also remains when you open the affected tab and queues additional unresolved manual incidents instead of replacing them.

The alert text identifies what happened and the required action. Ordinary activity and recoverable infrastructure states (`TIMEOUT`, `PAGE_STALE`, `CONNECTION_LOST`, `RECOVERY_FAILED`, and internal unsafe-state `UNCERTAIN`) remain quiet while automatic recovery and Advanced Logger diagnostics continue. A historical completed answer already present when the extension starts does not generate a new completion notification merely because the page was reopened or the extension was reloaded.

## Safe timeout recovery

Automatic page refresh is restricted to a confirmed `TIMEOUT`. Stale extension/bridge health uses the native connection-repair and managed-Chrome recovery controller without asking the user to verify or repair it. Paused, waiting-input, or stuck-Thinking content is never refreshed away.

Before a timeout reload, the service worker waits about 12 seconds and probes the live tab again. It cancels the reload if the timeout cleared, if a Stop/Continue control exists, if the composer contains a draft, or if the tab has moved to another conversation.

A real reload is an ordinary cached Chrome reload. Recovery is globally limited to no more than one reload per 15 minutes and four reloads in a rolling six-hour window. Cancelled checks do not spend refresh quota.

## Progress UI

The extension popup and in-page monitor show the current state and latest reliable percentage. Progress is extracted from the entire latest active assistant turn, including streaming commentary rendered outside the final assistant-role child; that child remains the fallback. Line boundaries are preserved so a heading such as `30% — archive readiness` remains parseable. This prevents hidden/auxiliary assistant nodes or split streaming markup from masking visible text such as `30% complete` or `65% complete`. Only task-progress-shaped markers are authoritative, for example `75% complete`, `Progress: 75%`, or a line-leading progress heading such as `76% — integration complete`. Bare percentages from coverage, pass rate, accuracy, confidence, or other metrics are ignored as task progress. The latest explicit task-progress marker wins. Historical percentages are display-only and cannot veto or manufacture completion or Resume for a newer response. Progress-only changes are propagated to storage/UI even when the state name does not change. Negated phrases such as `not 100% complete` cannot satisfy the completion gate.

The bridge accepts progress only as `null` or a finite JSON number from 0 through 100; malformed values receive HTTP 400 and are neither clamped nor coerced. `COMPLETE` and 100% are shown as a terminal result only when `safeCompletion=true`. When a running task has no reported percentage, elapsed time since its observed start supplies a labelled estimate: 13 minutes = 50%, 26 minutes = 100%, capped at 100%. Reported percentages take priority. Estimated 100% never declares completion or blocks autopilot; actual completion still requires response evidence. Historical idle pages without an observed start remain percentage-unavailable. Percentage-only heartbeats update UI state without producing notification spam.

## Managed Chrome boundary

The notifier uses your normal Chrome installation, original user-data directory, selected profile, cookies, and signed-in ChatGPT session. It opens one new Chrome window and captures that exact window as the managed window.

It does not create or copy a Chrome profile. It does not pass `--user-data-dir`, kill `chrome.exe`, modify Chrome policy, or manage your ordinary Chrome windows. The native runtime uses the captured HWND. The extension uses the corresponding managed Chrome `windowId`.

## Start

For normal use, double-click the only BAT file in the program root: `START_CHATGPT_WORK_NOTIFIER.bat`. It starts and verifies the Advanced Logger, then launches the notifier. The installed Windows logon entry uses that same logger bootstrap, so every normal app start creates or reuses a live recorder session before the notifier starts. Potentially confusing install, uninstall, validation, logger-status/stop, diagnostic-bundle, and notifier-only BAT files are isolated under `Maintenance`.

For an intentional installation or upgrade, use `Maintenance\INSTALL_OR_UPGRADE.bat`. It safely stops any verified older ChatGPT Work Notifier runtime—even when that release is in another folder—installs the startup entry, then invokes the root launcher with Advanced Logger. It does not stop ordinary Chrome or unrelated PowerShell programs. `Maintenance\LAUNCH_NOTIFIER_ONLY.bat` is reserved for maintenance when logging is intentionally not required.

If the dashboard says the extension heartbeat is not connected, open `chrome://extensions` in the same Chrome profile, enable Developer mode, and load or reload this release folder as an unpacked extension. Then refresh the notifier-created ChatGPT tab once.

## Reliability and privacy

Each managed ChatGPT tab has independent state. Tabs moved out are removed from monitoring. Tabs moved in are enrolled. Managed tabs are protected with `autoDiscardable=false`.

The worker reconciles the dashboard tab list against Chrome’s actual open managed ChatGPT tabs on removal, during live command polling (at most once per five seconds), and on the one-minute health alarm. Missed close messages and bridge-only stale rows are removed automatically. Closing the final managed window saves a retryable empty inventory until the bridge confirms it. Failed browser queries never count as an empty inventory, and late messages from closed or moved tabs cannot recreate rows. The Windows dashboard displays the refreshed bridge state on its two-second update cycle.

The private bridge listens only on `127.0.0.1:38765`. Browser/state-changing control traffic is authenticated with the active managed-session token. Public `/state` exposes safe status/progress/freshness fields but omits ChatGPT URL, conversation, and title data; authenticated local `POST /dashboard-state` adds only a sanitized title. It accepts status metadata, not prompt or response text. The extension does not call ChatGPT network APIs or synthesize keyboard input. Its only automatic page action is the guarded Resume/Continue-generating submission described above. Computer-awake protection defaults on; display-awake defaults off; lid-close policy is not changed.

## Validation

The standard source gate includes episode/outbox regressions for delayed delivery, retry notification settings, and retained completion proof. Completion retries respect paused monitoring, work mode, focus, and suppression; delayed acknowledgements only update their original task episode.

On Windows, start with `CODEX_EXECUTE_FIRST.md` or run `Maintenance\RUN_CODEX_FINAL_WINDOWS_VALIDATION.bat` for the non-interactive source gates. Live runtime verification is performed with:

```bat
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File tests\VERIFY_RUNTIME.ps1
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File tests\SECURITY_WINDOWS_RUNTIME.ps1
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File runtime\diagnostics.ps1
```

The exact live/manual matrix is in `tests\MANUAL_VALIDATION.md`.
