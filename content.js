(() => {
  "use strict";

  const E = globalThis.CWNStateEngine;
  if (!E || !globalThis.chrome?.runtime) return;

  const HEARTBEAT_MS = 20 * 1000;
  const COMMAND_POLL_MS = 3000;
  const SCAN_FALLBACK_MS = 5000;
  const MANUAL_ACTION_STATUSES = new Set(["PAUSED","STUCK_THINKING","WAITING_INPUT","FAILED"]);
  const WORK_KEYWORDS = /\b(upgrade|repair|audit|build|implement|convert|generate|analyse|analyze|review|research|create|fix|test|package|zip|document|rewrite|install|migration|refactor)\b/i;
  const FAILURE_PATTERNS = [
    /\bsomething went wrong\b/i, /\bfailed to (?:generate|load|respond)\b/i,
    /\berror (?:generating|loading|processing)\b/i, /\bserver error\b/i
  ];
  const WAITING_PATTERNS = [
    /\b(?:need|needs) (?:your|a) (?:input|reply|response|confirmation|choice|approval)\b/i,
    /\bplease (?:reply|upload|choose|confirm|provide|send|select)\b/i,
    /\bwhich (?:option|file|version|one)\b/i, /\bwould you like\b/i
  ];

  const S = {
    managed: false,
    monitoringEnabled: true,
    extensionConnected: true,
    commandLeader: false,
    commandTimer: null,
    scanTimer: null,
    lastFingerprint: "",
    lastFingerprintAt: Date.now(),
    lastState: "",
    lastMessageId: "",
    lastSentSignature: "",
    lastPayload: null,
    lastVisibleProgress: null,
    progressByMessage: Object.create(null),
    generationObserved: false,
    runStartedAt: null,
    currentPrompt: "",
    baselineUserSignature: "",
    baselineReady: false,
    prefilledFor: "",
    stablePauseReportedFor: Object.create(null),
    overlay: null,
    alertBar: null,
    dismissedAlertKey: "",
    externalAttention: null,
    lastInternalErrorAt: 0,
    initializedBaseline: false,
    terminalDeliveryConfirmed: false,
    terminalRetryTimer: null,
    episodeId: null,
    episodeRevision: 0,
    segmentId: null,
    resumeContinuation: false
  };
  S.autoResumeBusy = false;
  S.autoResumeNote = "";
  S.autoResumeAttempts = new Set();

  // Estimates are presentation only: never feed them into the state classifier.
  function withEstimatedProgress(result, now = Date.now()) {
    if (result.progress != null || !S.generationObserved || S.runStartedAt == null ||
        !["RUNNING", "PAUSED", "STUCK_THINKING"].includes(result.status)) return { ...result, progressEstimated: false };
    return { ...result, progress: Math.min(100, Math.max(0, Math.round((now - S.runStartedAt) / (26 * 60 * 1000) * 100))), progressEstimated: true };
  }

  async function autoResume(result) {
    if (S.autoResumeBusy || !S.managed || !S.monitoringEnabled || !S.generationObserved ||
        !result.resumeEligible || !["PAUSED", "STUCK_THINKING"].includes(result.status)) return;
    S.autoResumeBusy = true;
    if (!S.autoResumeNote) S.autoResumeNote = "Autopilot checking resume";
    const href = location.href;
    try {
      const permission = await safeSendMessage({ type: "AUTOPILOT_CHECK", url: href });
      if (!permission?.allowed || location.href !== href) { S.autoResumeNote = "Autopilot unavailable or disabled"; return; }
      const snap = snapshot();
      const live = E.classify(snap);
      if (!S.managed || !S.monitoringEnabled || !live.resumeEligible || !S.generationObserved ||
          !["PAUSED", "STUCK_THINKING"].includes(live.status) || snap.hasStopButton ||
          snap.hasExtendedThinkingBanner || snap.awaitingAssistant || snap.waitingInput || snap.errorText ||
          (live.status === "PAUSED" && live.stableMs < 8000)) return;
      const key = `cwn-auto-resume:${canonicalConversationPath(href)}:${live.messageId}:${responseSignature(snap.assistantText + snap.workedText)}`;
      // Record before clicking: an ambiguous submission must not send Resume twice,
      // including after an extension reload in this tab.
      if (S.autoResumeAttempts.has(key) || sessionStorage.getItem(key)) { S.autoResumeNote = "Resume sent; waiting for ChatGPT"; return; }
      let c = composerInfo();
      const ownDraft = c.text === "Resume" && S.prefilledFor === (live.messageId || `state:${live.status}:${String(live.progress)}`);
      if (!c.empty && !ownDraft) { S.autoResumeNote = "Autopilot waiting: draft preserved"; return; }
      const form = (c.editor || c.fallback)?.closest("form");
      if (form && ([...form.querySelectorAll('input[type="file"]')].some(input => input.files?.length) ||
          form.querySelector('[data-testid*="attachment"],button[aria-label*="Remove file" i],button[aria-label*="Remove attachment" i]'))) {
        S.autoResumeNote = "Autopilot waiting: attachment preserved"; return;
      }
      const turn = latestAssistantTurn() || turnForAssistant(latestAssistant());
      const continuation = turn && [...turn.querySelectorAll("button")].find(btn => visible(btn) && !btn.disabled && btn.getAttribute("aria-disabled") !== "true" && /\bcontinue generating\b/i.test(`${text(btn)} ${btn.getAttribute("aria-label") || ""}`));
      let button = c.empty ? continuation : null;
      if (!button) {
        if (!visible(c.editor || c.fallback)) { S.autoResumeNote = "Autopilot waiting for composer"; return; }
        const prefill = prefillResume({ ...live, composerEmpty: c.empty });
        if (!prefill.ok) { S.autoResumeNote = "Autopilot could not prepare Resume"; return; }
        c = composerInfo();
        button = [...document.querySelectorAll('button[data-testid="send-button"],button#composer-submit-button[aria-label*="Send" i],button[aria-label="Send prompt" i]')]
          .find(btn => visible(btn) && !btn.disabled && btn.getAttribute("aria-disabled") !== "true" && (!form || btn.closest("form") === form));
        if (!button || c.text !== "Resume") { S.autoResumeNote = "Autopilot waiting for Send button"; return; }
      }
      if (hasStopButton() || location.href !== href) return;
      sessionStorage.setItem(key, String(Date.now()));
      S.autoResumeAttempts.add(key);
      S.resumeContinuation = true;
      S.autoResumeNote = "Resume sent; waiting for ChatGPT";
      button.click();
    } catch (error) {
      S.autoResumeNote = "Autopilot could not resume; manual action available";
      reportInternalError(error);
    } finally { S.autoResumeBusy = false; }
  }

  function text(el) { return el ? String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : ""; }
  function structuredText(el) {
    if (!el) return "";
    return String(el.innerText || el.textContent || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t\f\v ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  function last(list) { return list?.length ? list[list.length - 1] : null; }
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }
  function canonicalConversationPath(value, base) {
    try { return new URL(value, base || location.href).pathname.replace(/\/+$/, "") || "/"; } catch (_) { return ""; }
  }
  function titleFromCurrentConversationLinks(links, currentHref) {
    const currentPath = canonicalConversationPath(currentHref, currentHref);
    if (!currentPath) return "";
    const matches = [...(links || [])].filter(link =>
      canonicalConversationPath(link.getAttribute?.("href") || "", currentHref) === currentPath &&
      (link.getAttribute?.("aria-current") === "page" || link.closest?.('nav,aside,[data-testid*="sidebar" i]'))
    );
    matches.sort((a, b) => Number(b.getAttribute?.("aria-current") === "page") - Number(a.getAttribute?.("aria-current") === "page"));
    for (const link of matches) {
      const titled = link.querySelector?.('[title]:not([title=""])');
      const raw = titled?.getAttribute("title") || link.innerText || link.textContent || "";
      const firstLine = String(raw).split(/\r?\n/).map(x => x.replace(/\s+/g, " ").trim()).find(Boolean) || "";
      if (firstLine && !/^(?:ChatGPT|More actions|Options)$/i.test(firstLine)) return firstLine.slice(0, 180);
    }
    return "";
  }
  function cleanTitle() {
    const sidebarTitle = titleFromCurrentConversationLinks(document.querySelectorAll('a[href]'), location.href);
    if (sidebarTitle) return sidebarTitle;
    return (document.title || "ChatGPT").replace(/\s*[|–—-]\s*ChatGPT\s*$/i, "").trim().slice(0, 180) || "ChatGPT";
  }
  function latestAssistant() { return last([...document.querySelectorAll('[data-message-author-role="assistant"]')]); }
  function latestAssistantTurn() { return last([...document.querySelectorAll('section[data-turn="assistant"],[data-turn="assistant"]')]); }
  function latestUser() { return last([...document.querySelectorAll('[data-message-author-role="user"]')]); }
  function assistantForTurn(turn) {
    if (!turn) return null;
    const nodes = [];
    if (turn.matches?.('[data-message-author-role="assistant"]')) nodes.push(turn);
    nodes.push(...turn.querySelectorAll('[data-message-author-role="assistant"]'));
    return last(nodes);
  }
  function assistantTextForTurn(turn, assistant) {
    // ChatGPT can render streaming progress/commentary as a sibling of the final
    // data-message-author-role child. Preserve line boundaries because a leading
    // "30% —" progress heading is authoritative even without the word "complete".
    return structuredText(turn) || structuredText(assistant);
  }
  function turnForAssistant(assistant) {
    if (!assistant) return null;
    return assistant.closest('section[data-turn="assistant"],[data-turn="assistant"],[data-testid^="conversation-turn-"]') || assistant.parentElement;
  }
  function comesAfter(node, anchor) {
    if (!node || !anchor || node === anchor) return false;
    try { return Boolean(anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING); } catch (_) { return false; }
  }
  function latestUserText() { return text(latestUser()); }
  function responseSignature(value) {
    const s = String(value || "").replace(/\s+/g, " ").trim();
    let h = 2166136261;
    const sample = `${s.length}:${s.slice(-220)}`;
    for (let i = 0; i < sample.length; i++) { h ^= sample.charCodeAt(i); h = Math.imul(h, 16777619); }
    return `${s.length}:${(h >>> 0).toString(16)}`;
  }

  function currentWorkedText(scope) {
    if (!scope) return "";
    const buttons = [...scope.querySelectorAll("button")];
    for (let i = buttons.length - 1; i >= 0; i--) {
      const t = text(buttons[i]);
      if (/^Worked for\s+/i.test(t)) return t;
    }
    return "";
  }

  function errorCandidates(anchor, assistant) {
    const candidates = [];
    const scope = assistant ? turnForAssistant(assistant) : null;
    if (scope) {
      for (const el of [...scope.querySelectorAll('.text-token-text-error,[role="alert"],[data-testid*="error" i]')].reverse()) {
        const t = text(el); if (t) candidates.push(t);
      }
    }
    for (const el of [...document.querySelectorAll('.text-token-text-error,[role="alert"],[data-testid*="error" i]')].reverse()) {
      if (!anchor || el === anchor || comesAfter(el, anchor)) { const t = text(el); if (t) candidates.push(t); }
    }
    const at = text(assistant); if (at && at.length <= 600) candidates.push(at);
    return candidates;
  }

  function explicitErrorText(anchor, assistant) {
    const patterns = [
      /Message delivery timed out\. Please try again\.?/i,
      /something went wrong while generating the response/i,
      /network error/i,
      /connection (?:was )?(?:lost|interrupted)/i,
      /failed to get response/i,
      ...FAILURE_PATTERNS
    ];
    for (const candidate of errorCandidates(anchor, assistant)) {
      if (patterns.some(re => re.test(candidate))) return candidate.slice(0, 500);
    }
    return "";
  }

  function hasStopButton() {
    const selectors = [
      '[data-testid="stop-button"]', '#composer-submit-button[aria-label^="Stop" i]', '#composer-submit-button[aria-label*="Stop answering" i]',
      'button[aria-label*="Stop answering" i]', 'button[aria-label*="Stop generating" i]',
      'button[aria-label*="Stop streaming" i]'
    ];
    return selectors.some(sel => [...document.querySelectorAll(sel)].some(visible));
  }
  function hasContinueButton(turn) {
    if (!turn) return false;
    return [...turn.querySelectorAll("button")].some(btn => visible(btn) && /\bcontinue generating\b/i.test(`${text(btn)} ${btn.getAttribute("aria-label") || ""}`));
  }
  function thinkingStatusText(turn) {
    if (!turn) return "";
    const status = turn.querySelector("[data-streaming-response-status]");
    return status ? text(status) : "";
  }
  function hasThinkingIndicator(turn) {
    if (!turn) return false;
    const status = turn.querySelector("[data-streaming-response-status]");
    if (!status) return false;
    const nodes = [...status.querySelectorAll(".loading-shimmer-tertiary,span")];
    return nodes.some(n => /^Thinking$/i.test(text(n))) || /^Thinking$/i.test(text(status));
  }
  function extendedThinkingBannerText(turn) {
    const pattern = /Our systems are thinking a bit more about this request before responding/i;
    const selector = 'p,[role="status"],[aria-live],[data-streaming-response-status]';
    const candidates = turn ? [...turn.querySelectorAll(selector)] : [];
    for (const el of [...document.querySelectorAll(selector)]) {
      if (!candidates.includes(el)) candidates.push(el);
    }
    for (let i = candidates.length - 1; i >= 0; i--) {
      const el = candidates[i];
      if (!visible(el)) continue;
      // Platform status chrome is evidence. Quoted/mentioned text inside actual user or assistant
      // message bodies is not, otherwise discussing this exact banner could create a false RUNNING state.
      if (el.closest('[data-message-author-role="assistant"],[data-message-author-role="user"]')) continue;
      const t = text(el);
      if (t.length <= 1200 && pattern.test(t)) return t.slice(0, 500);
    }
    return "";
  }
  function activeToolStatusText(turn) {
    if (!turn) return "";
    const pattern = /\b(?:Inspecting|Reviewing|Analyzing|Analysing|Reading|Searching|Browsing|Testing|Checking|Verifying|Building|Generating|Creating|Editing|Writing|Packaging|Processing|Computing|Loading)\b/i;
    const candidates = [...turn.querySelectorAll('button,[role="status"],[data-testid*="tool" i],[data-testid*="cot" i]')];
    for (let i = candidates.length - 1; i >= 0; i--) {
      const el = candidates[i];
      if (!visible(el)) continue;
      const t = text(el);
      if (t && t.length <= 500 && pattern.test(t)) return t.slice(0, 300);
    }
    return "";
  }
  function hasCompletedResponseControls(turn) {
    if (!turn) return false;
    return Boolean(turn.querySelector(
      '[aria-label="Response actions"] button[data-testid="copy-turn-action-button"][aria-label*="response" i],button[data-testid="copy-turn-action-button"][aria-label="Copy response" i]'
    ));
  }
  function composerInfo() {
    const editor = document.querySelector('#prompt-textarea[contenteditable="true"],div[contenteditable="true"][aria-label="Chat with ChatGPT"]');
    const fallback = document.querySelector('textarea[name="prompt-textarea"]');
    const current = editor ? text(editor) : fallback ? String(fallback.value || "").trim() : "";
    return { editor, fallback, empty: current.length === 0, text: current };
  }
  function looksWaiting(value) {
    const tail = String(value || "").slice(-1800);
    if (WAITING_PATTERNS.some(re => re.test(tail))) return true;
    const line = tail.split(/\n+/).map(x => x.trim()).filter(Boolean).pop() || "";
    return line.endsWith("?") && line.length < 260;
  }
  function workLike() { return WORK_KEYWORDS.test(S.currentPrompt || latestUserText()); }

  function rememberProgress(messageId, progress) {
    if (progress == null) return;
    S.lastVisibleProgress = progress;
    if (messageId) {
      S.progressByMessage[messageId] = progress;
      const keys = Object.keys(S.progressByMessage);
      if (keys.length > 30) delete S.progressByMessage[keys[0]];
    }
  }
  function priorDisplayProgress(messageId) {
    if (messageId && S.progressByMessage[messageId] != null) return S.progressByMessage[messageId];
    // Global historical progress is never authoritative after the observed segment
    // has ended. Same-episode carry is supplied by the worker, not this page cache.
    return S.generationObserved ? S.lastVisibleProgress : null;
  }

  function snapshot() {
    const fallbackAssistant = latestAssistant();
    const assistantTurn = latestAssistantTurn() || turnForAssistant(fallbackAssistant);
    const user = latestUser();
    const turnAfterUser = Boolean(assistantTurn && (!user || comesAfter(assistantTurn, user)));
    const userText = text(user);
    const userSignature = responseSignature(userText);
    // During page hydration ChatGPT can render the historical user turn before its already
    // completed assistant turn. That is not a newly submitted prompt. Awaiting-response state
    // is authoritative only when the latest user message changed after this content script
    // established its startup baseline.
    const awaitingAssistant = Boolean(S.baselineReady && user && !turnAfterUser && userSignature !== S.baselineUserSignature);
    const resumeSubmission = awaitingAssistant && /^Resume$/i.test(userText) && (Boolean(S.episodeId) || S.resumeContinuation);
    if (awaitingAssistant && userSignature !== S.baselineUserSignature && userSignature !== S.observedUserSignature && !resumeSubmission) {
      S.observedUserSignature = userSignature;
      S.lastVisibleProgress = null;
      S.progressByMessage = Object.create(null);
      S.generationObserved = false;
      S.episodeId = null;
      S.segmentId = null;
      S.resumeContinuation = false;
      S.autoResumeNote = "";
    }
    const currentTurn = awaitingAssistant ? null : assistantTurn;
    // Resolve the assistant message from inside the active turn. ChatGPT may append hidden or
    // auxiliary assistant-role nodes elsewhere in the DOM after the visible streaming turn.
    const currentAssistant = assistantForTurn(currentTurn);
    const anchor = awaitingAssistant ? user : (currentTurn || currentAssistant);
    const assistantText = assistantTextForTurn(currentTurn, currentAssistant);
    const errorText = explicitErrorText(anchor, currentAssistant);
    const workedText = currentWorkedText(currentTurn || currentAssistant);
    const thinking = hasThinkingIndicator(currentTurn);
    const thinkingStatus = thinkingStatusText(currentTurn);
    const extendedThinkingText = extendedThinkingBannerText(currentTurn);
    const activeToolText = activeToolStatusText(currentTurn);
    const completedResponseControls = hasCompletedResponseControls(currentTurn);
    const stop = hasStopButton();
    const cont = hasContinueButton(currentTurn);
    const composer = composerInfo();
    const messageId = currentAssistant ? (currentAssistant.getAttribute("data-message-id") || currentAssistant.getAttribute("data-testid") || "") :
      currentTurn ? (currentTurn.getAttribute("data-turn-id") || currentTurn.getAttribute("data-testid") || "") : "";
    const progress = E.parseProgressPercent(assistantText);
    rememberProgress(messageId, progress);
    // After a page restore, the current assistant turn may still show active tool/status
    // rows even though this content-script instance did not witness the original Stop
    // control. Treat that combination plus explicit sub-100% task progress as an
    // observed run, but only for the turn after the latest user message and only when
    // no finalized response controls prove the answer already ended.
    const partialCurrentTurn = Boolean(turnAfterUser && activeToolText && progress != null && progress < 100 && !completedResponseControls);

    const fingerprint = [messageId, assistantText, errorText, workedText, thinking ? "thinking" : "", thinkingStatus, extendedThinkingText, activeToolText, completedResponseControls ? "finalized" : "", stop ? "1" : "0", cont ? "1" : "0", awaitingAssistant ? "1" : "0"].join("|");
    if (fingerprint !== S.lastFingerprint) { S.lastFingerprint = fingerprint; S.lastFingerprintAt = Date.now(); }
    const stableMs = Date.now() - S.lastFingerprintAt;

    if (stop || thinking || extendedThinkingText || awaitingAssistant || partialCurrentTurn) {
      if (!S.generationObserved) {
        S.generationObserved = true;
        S.runStartedAt = Date.now();
        S.currentPrompt = userText;
      }
    }

    return {
      assistantText,
      errorText,
      workedText,
      hasStopButton: stop,
      hasContinueButton: cont,
      hasThinkingIndicator: thinking,
      hasExtendedThinkingBanner: Boolean(extendedThinkingText),
      extendedThinkingText,
      hasActiveToolActivity: Boolean(activeToolText),
      activeToolText,
      hasCompletedResponseControls: completedResponseControls,
      thinkingStableMs: thinking ? stableMs : 0,
      awaitingAssistant,
      waitingInput: Boolean(assistantText && looksWaiting(assistantText)),
      composerEmpty: composer.empty,
      stableMs,
      progressPercent: progress,
      priorProgressPercent: priorDisplayProgress(messageId),
      messageId,
      segmentId: messageId || null,
      episodeId: S.episodeId,
      episodeRevision: S.episodeRevision,
      resumeContinuation: resumeSubmission || S.resumeContinuation,
      generationObserved: S.generationObserved,
      workLike: workLike(),
      pageVisible: document.visibilityState === "visible"
    };
  }

  function safeSetContentEditable(editor, value) {
    if (!editor) return false;
    try {
      editor.focus();
      const sel = window.getSelection(); const range = document.createRange();
      range.selectNodeContents(editor); sel.removeAllRanges(); sel.addRange(range);
      let ok = false;
      try { ok = document.execCommand("insertText", false, value); } catch (_) {}
      if (!ok) {
        editor.innerHTML = "";
        const p = document.createElement("p"); p.textContent = value; editor.appendChild(p);
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      }
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      return text(editor) === value;
    } catch (_) { return false; }
  }
  function safeSetTextarea(ta, value) {
    if (!ta) return false;
    try {
      const proto = Object.getPrototypeOf(ta);
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value") || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      if (descriptor?.set) descriptor.set.call(ta, value); else ta.value = value;
      ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
      return String(ta.value || "").trim() === value;
    } catch (_) { return false; }
  }
  function prefillResume(result) {
    if (!result.resumeEligible) return { attempted: false, ok: false, reason: "not-eligible" };
    const key = result.messageId || `state:${result.status}:${String(result.progress)}`;
    const c = composerInfo();
    if (S.prefilledFor === key && c.text === "Resume") return { attempted: false, ok: true, reason: "already-prefilled" };
    if (!result.composerEmpty || !c.empty) return { attempted: false, ok: false, reason: "draft-present" };
    const ok = safeSetContentEditable(c.editor, "Resume") || safeSetTextarea(c.fallback, "Resume");
    if (ok) S.prefilledFor = key;
    return { attempted: true, ok, reason: ok ? "prefilled" : "composer-write-failed" };
  }

  function ensureOverlay() {
    if (S.overlay && document.documentElement.contains(S.overlay)) return S.overlay;
    const el = document.createElement("div");
    el.id = "cwn-progress-monitor"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
    el.style.cssText = "position:fixed;right:18px;bottom:92px;z-index:2147483645;width:280px;max-width:calc(100vw - 36px);padding:10px 12px;border:1px solid rgba(37,99,235,.32);border-radius:12px;background:rgba(248,250,252,.96);box-shadow:0 8px 24px rgba(15,23,42,.14);font:600 12px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;backdrop-filter:blur(8px);pointer-events:none;";
    const head = document.createElement("div"); head.className = "cwn-progress-head"; head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:7px;";
    const state = document.createElement("span"); state.className = "cwn-progress-state"; state.style.cssText = "font-weight:800;color:#1d4ed8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const value = document.createElement("span"); value.className = "cwn-progress-value"; value.style.cssText = "flex:0 0 auto;font-variant-numeric:tabular-nums;color:#0f172a;";
    head.append(state, value);
    const track = document.createElement("div"); track.className = "cwn-progress-track"; track.style.cssText = "height:7px;overflow:hidden;border-radius:999px;background:#dbeafe;box-shadow:inset 0 0 0 1px rgba(37,99,235,.10);";
    const fill = document.createElement("div"); fill.className = "cwn-progress-fill"; fill.style.cssText = "height:100%;width:0;border-radius:inherit;background:#2563eb;transition:width .25s ease;"; track.appendChild(fill);
    const note = document.createElement("div"); note.className = "cwn-progress-note"; note.style.cssText = "margin-top:7px;font-weight:600;color:#475569;white-space:normal;";
    el.append(head, track, note);
    document.documentElement.appendChild(el); S.overlay = el; return el;
  }
  function renderOverlay(result, prefill) {
    if (!S.managed) return;
    const el = ensureOverlay();
    const safeComplete = result.status === "COMPLETE" && result.safeCompletion === true;
    const status = result.status === "COMPLETE" && !safeComplete ? "UNCERTAIN" : result.status;
    const reported = Number(result.progress);
    const known = result.progress != null && Number.isFinite(reported) && reported >= 0 && reported <= 100;
    const pct = safeComplete ? 100 : (result.status === "COMPLETE" ? null : (known ? reported : null));
    const noteText = ["PAUSED", "STUCK_THINKING"].includes(status) && S.autoResumeNote ? S.autoResumeNote : status === "PAUSED" ? (prefill?.ok ? "Resume pre-filled · click Send manually" : "Resume needed") :
      status === "STUCK_THINKING" ? (prefill?.ok ? "Thinking stuck · Resume pre-filled · click Send manually" : "Thinking stuck · Resume needed") :
      status === "TIMEOUT" ? "Completion blocked · safe recovery check only" :
      status === "COMPLETE" ? "Safe completion gate passed" :
      status === "RUNNING" && pct == null ? "Working — % unavailable" :
      status === "RUNNING" ? "Generation active" : result.detail;
    const stateEl = el.querySelector(".cwn-progress-state");
    const valueEl = el.querySelector(".cwn-progress-value");
    const trackEl = el.querySelector(".cwn-progress-track");
    const fillEl = el.querySelector(".cwn-progress-fill");
    const noteEl = el.querySelector(".cwn-progress-note");
    stateEl.textContent = status;
    valueEl.textContent = pct == null ? "% unavailable" : `${pct}%${result.progressEstimated ? " estimated" : ""}`;
    noteEl.textContent = noteText || result.label || "Monitoring";
    const indeterminate = status === "RUNNING" && pct == null;
    trackEl.dataset.indeterminate = String(indeterminate);
    trackEl.setAttribute("aria-label", "Current task progress");
    trackEl.setAttribute("aria-valuetext", pct == null ? "percentage unavailable" : `${pct} percent`);
    fillEl.style.width = indeterminate ? "32%" : `${pct == null ? 0 : pct}%`;
    fillEl.style.opacity = indeterminate ? ".55" : "1";
    fillEl.style.background = indeterminate ? "linear-gradient(90deg,#93c5fd,#2563eb)" : "#2563eb";
    el.style.borderColor = /TIMEOUT|FAILED/i.test(status) ? "rgba(185,28,28,.42)" : /PAUSED|STUCK|UNCERTAIN|WAITING/i.test(status) ? "rgba(180,83,9,.40)" : "rgba(37,99,235,.32)";
  }

  function attentionEpisode(a) { return [a.status || "", a.messageId || "", a.kind || ""].join("|"); }
  function ensureAlertBar() {
    if (S.alertBar && document.documentElement.contains(S.alertBar)) return S.alertBar;
    const el = document.createElement("div");
    el.id = "cwn-manual-action-bar"; el.setAttribute("role", "alert"); el.setAttribute("aria-live", "assertive");
    el.style.cssText = "position:fixed;top:12px;left:12px;right:12px;z-index:2147483647;display:none;align-items:center;gap:14px;padding:13px 14px;border:1px solid #f59e0b;border-radius:12px;background:#fff7ed;color:#431407;box-shadow:0 12px 38px rgba(15,23,42,.28);font:600 13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;pointer-events:auto;";
    const body = document.createElement("div"); body.dataset.role = "body"; body.style.cssText = "flex:1;min-width:0;"; el.appendChild(body);
    const close = document.createElement("button"); close.type = "button"; close.textContent = "Dismiss"; close.setAttribute("aria-label", "Dismiss this notifier alert");
    close.style.cssText = "flex:0 0 auto;border:1px solid rgba(67,20,7,.28);border-radius:9px;background:#fff;color:#431407;padding:7px 10px;font:700 12px system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer;";
    close.addEventListener("click", () => { S.dismissedAlertKey = el.dataset.episode || ""; el.style.display = "none"; }); el.appendChild(close);
    document.documentElement.appendChild(el); S.alertBar = el; return el;
  }

  function attentionFromResult(result, prefill) {
    if (result.status === "PAUSED") {
      const p = result.progress == null ? "Partial progress" : `${result.progress}%${result.progressEstimated ? " estimated" : ""} progress`;
      const action = S.autoResumeNote ? ` ${S.autoResumeNote}.` : prefill?.ok ? " ‘Resume’ is pre-filled. Review it, then click the blue Send arrow manually." : prefill?.reason === "composer-write-failed" ? " Resume could not be pre-filled. Type ‘Resume’ manually, then click Send." : " Resume is required. Nothing will be sent automatically.";
      return { status: "PAUSED", kind: "PAUSED", messageId: result.messageId, progress: result.progress, detail: `${p} is paused.${action}` };
    }
    if (result.status === "STUCK_THINKING") {
      const action = S.autoResumeNote ? ` ${S.autoResumeNote}.` : prefill?.ok ? " ‘Resume’ is pre-filled. Review it, then click the blue Send arrow manually." : prefill?.reason === "composer-write-failed" ? " Resume could not be pre-filled. Type ‘Resume’ manually, then click Send." : " Resume is required. Nothing will be sent automatically.";
      return { status: "STUCK_THINKING", kind: "STUCK_THINKING", messageId: result.messageId, progress: result.progress, detail: `ChatGPT is stuck on Thinking with no active Stop control. Completion is blocked.${action}` };
    }
    if (result.status === "WAITING_INPUT") return { status: "WAITING_INPUT", kind: "WAITING_INPUT", messageId: result.messageId, progress: result.progress, detail: "ChatGPT is waiting for your reply, confirmation, choice, or upload. Open this tab and respond manually." };
    if (result.status === "FAILED") return { status: "FAILED", kind: "FAILED", messageId: result.messageId, progress: result.progress, detail: "ChatGPT reported an error. Completion is blocked. Open this tab and recover manually." };
    return null;
  }

  function renderManualAlert(result, prefill) {
    if (!S.managed) return;
    const direct = attentionFromResult(result, prefill);
    const a = S.externalAttention || direct;
    const el = ensureAlertBar();
    if (!a) { S.dismissedAlertKey = ""; el.style.display = "none"; return; }
    const key = attentionEpisode(a); el.dataset.episode = key;
    if (S.dismissedAlertKey === key) { el.style.display = "none"; return; }
    const body = el.querySelector('[data-role="body"]');
    const pct = a.progress == null ? "" : `${a.progress}% · `;
    body.textContent = `${pct}${a.label || a.status || "Action required"} — ${String(a.detail || "Manual action is required.")}`;
    const danger = /TIMEOUT|RECOVERY|ERROR|FAILED|STALE|CONNECTION/i.test(String(a.status || a.kind || ""));
    el.style.borderColor = danger ? "#ef4444" : "#f59e0b"; el.style.background = danger ? "#fef2f2" : "#fff7ed"; el.style.color = danger ? "#7f1d1d" : "#431407"; el.style.display = "flex";
  }

  async function safeSendMessage(payload) {
    try {
      const response = await chrome.runtime.sendMessage(payload);
      const recovered = !S.extensionConnected; S.extensionConnected = true;
      if (response?.monitoringEnabled != null) S.monitoringEnabled = Boolean(response.monitoringEnabled);
      if (recovered && payload.type === "HEARTBEAT" && S.managed) setTimeout(() => sendState("MONITORING_RECOVERED", { force: true, forceEvent: true, detail: "Extension messaging recovered." }), 0);
      return response;
    } catch (_) { S.extensionConnected = false; return null; }
  }

  async function registerManagedWindow() {
    let token = new URL(location.href).searchParams.get("cwn_managed");
    if (!token) { try { token = sessionStorage.getItem("cwn_managed_token"); } catch (_) {} }
    if (token && /^[a-f0-9]{32}$/i.test(token)) {
      const response = await safeSendMessage({ type: "REGISTER_MANAGED_WINDOW", token });
      if (response?.ok) S.managed = true;
    }
    if (!S.managed) {
      const probe = await safeSendMessage({ type: "HEARTBEAT", status: "IDLE", chatTitle: cleanTitle(), url: location.href });
      S.managed = Boolean(probe?.ok);
    }
    return S.managed;
  }

  function payloadFor(result, prefill, snap) {
    return {
      type: "STATE",
      status: result.status,
      chatTitle: cleanTitle(),
      pageFocused: document.visibilityState === "visible" && document.hasFocus(),
      progress: result.progress,
      progressEstimated: result.progressEstimated === true,
      runSeconds: S.runStartedAt ? (Date.now() - S.runStartedAt) / 1000 : null,
      workLike: workLike(),
      url: location.href,
      detail: result.detail,
      forceEvent: false,
      forceNotification: false,
      safeCompletion: Boolean(result.safeCompletion),
      refreshEligible: Boolean(result.refreshEligible),
      resumeEligible: Boolean(result.resumeEligible),
      manualAction: Boolean(result.manualAction),
      messageId: result.messageId,
      segmentId: snap.segmentId || result.messageId || null,
      episodeId: S.episodeId,
      episodeRevision: S.episodeRevision,
      resumeContinuation: Boolean(S.resumeContinuation),
      workedSeconds: result.workedSeconds,
      stableMs: result.stableMs,
      composerEmpty: snap.composerEmpty,
      awaitingAssistant: snap.awaitingAssistant,
      hasThinkingIndicator: snap.hasThinkingIndicator,
      hasExtendedThinkingBanner: snap.hasExtendedThinkingBanner,
      hasActiveToolActivity: snap.hasActiveToolActivity,
      activeToolText: snap.activeToolText || null,
      hasCompletedResponseControls: snap.hasCompletedResponseControls,
      hasStopButton: snap.hasStopButton,
      hasContinueButton: snap.hasContinueButton,
      thinkingStableMs: snap.thinkingStableMs,
      resumePrefill: prefill || null,
      timestamp: Date.now()
    };
  }

  async function emit(result, prefill, snap, options = {}) {
    if (!S.managed || !S.monitoringEnabled) return null;
    const p = payloadFor(result, prefill, snap);
    p.forceEvent = Boolean(options.forceEvent); p.forceNotification = Boolean(options.forceNotification);
    const terminal = result.status === "COMPLETE" || result.status === "WAITING_INPUT";
    if (terminal) S.terminalDeliveryConfirmed = false;
    const sig = `${p.status}|${p.progress}|${p.messageId}|${p.detail}|${prefill?.reason || ""}`;
    // Publish the freshly classified state before any asynchronous bridge call. The
    // timeout-recovery probe is synchronous from the content-script listener's point
    // of view; leaving lastPayload stale here made a valid TIMEOUT look like RUNNING
    // and silently cancelled the bounded refresh.
    S.lastPayload = p;
    if (S.lastSentSignature === sig && !options.force) {
      S.lastPayload = p;
      if (terminal) S.terminalDeliveryConfirmed = true;
      return { ...p, deliveryConfirmed: true };
    }
    let response = await safeSendMessage(p);
    if (!response?.ok) { await new Promise(r => setTimeout(r, 750)); response = await safeSendMessage(p); }
    // Legacy acknowledgement shape retained for compatibility: const delivered = Boolean(response?.ok).
    // `committed` means only durable state commit; downstream delivery is outbox-owned.
    const committed = Boolean(response?.stateCommitted || response?.ok);
    if (committed) {
      S.lastSentSignature = sig;
      if (response?.episodeId) S.episodeId = response.episodeId;
      if (response?.terminalEventId) S.terminalEventId = response.terminalEventId;
      if (Number.isFinite(Number(response?.episodeRevision))) S.episodeRevision = Number(response.episodeRevision);
      if (terminal) {
        S.terminalDeliveryConfirmed = true;
        if (S.terminalRetryTimer) { clearTimeout(S.terminalRetryTimer); S.terminalRetryTimer = null; }
        // scan() may already have passed the acknowledgement-gated reset point.
        resetRunAfterTerminal(result);
      }
    } else if (terminal && !S.terminalRetryTimer) {
      // A terminal event is safety-critical: retry a bounded number of times before
      // allowing the normal scan loop to re-establish the state. This prevents a
      // transient extension/bridge failure from becoming a silent RUNNING -> IDLE.
      const attempt = Number(options.terminalRetry || 0);
      if (attempt < 4) {
        const delay = 1200 * (attempt + 1);
        S.terminalRetryTimer = setTimeout(async () => {
          S.terminalRetryTimer = null;
          await emit(result, prefill, snap, { ...options, force: true, forceEvent: true, terminalRetry: attempt + 1 });
        }, delay);
      } else {
        S.lastState = "";
        S.lastSentSignature = "";
      }
    }
    if (p.status === "TIMEOUT" && p.refreshEligible) safeSendMessage({ type: "REQUEST_TIMEOUT_RECOVERY", state: p });
    return { ...p, deliveryConfirmed: committed, stateCommitted: committed };
  }

  async function sendState(status, extra = {}) {
    const snap = snapshot();
    const result = { status, label: status, progress: extra.progress ?? snap.progressPercent ?? snap.priorProgressPercent, safeCompletion: false, refreshEligible: false, resumeEligible: false, manualAction: false, detail: extra.detail || "", messageId: snap.messageId, workedSeconds: null, stableMs: snap.stableMs };
    return emit(result, null, snap, extra);
  }

  function reportInternalError(err) {
    const now = Date.now(); if (now - S.lastInternalErrorAt < 60000) return; S.lastInternalErrorAt = now;
    safeSendMessage({ type: "MONITOR_INTERNAL_ERROR", timestamp: now, url: location.href, chatTitle: cleanTitle(), detail: String(err?.message || err || "Unknown monitor error") });
  }

  function resetRunAfterTerminal(result) {
    if (["COMPLETE","WAITING_INPUT","PAUSED","STUCK_THINKING","TIMEOUT","FAILED"].includes(result.status)) {
      if (result.status === "COMPLETE") {
        if (!S.terminalDeliveryConfirmed) return;
        S.generationObserved = false;
        S.runStartedAt = null;
        S.baselineUserSignature = responseSignature(latestUserText());
      }
    }
  }

  function scan(forceEmit = false) {
    if (!S.managed || !S.monitoringEnabled || !S.baselineReady) return S.lastPayload;
    try {
      const snap = snapshot();
      let result = E.classify(snap);
      if (snap.errorText && FAILURE_PATTERNS.some(re => re.test(snap.errorText)) && result.status !== "TIMEOUT") {
        result = { ...result, status: "FAILED", label: "Error", safeCompletion: false, refreshEligible: false, resumeEligible: false, manualAction: true, detail: "ChatGPT reported an error. Completion is blocked." };
      }
      let prefill = { attempted: false, ok: false, reason: "not-needed" };
      if (result.resumeEligible && ((result.status === "PAUSED" && result.stableMs >= 8000) || result.status === "STUCK_THINKING")) {
        void autoResume(result);
        prefill = { attempted: false, ok: false, reason: S.autoResumeNote || "Autopilot checking resume" };
      }
      result = withEstimatedProgress(result);
      renderOverlay(result, prefill); renderManualAlert(result, prefill);

      const pauseKey = `${result.messageId || "no-message"}|${result.status}|${String(snap.progressPercent)}`;
      const crossedStablePause = ((result.status === "PAUSED" && result.stableMs >= 8000) || result.status === "STUCK_THINKING") && !S.stablePauseReportedFor[pauseKey];
      if (crossedStablePause) S.stablePauseReportedFor[pauseKey] = true;
      const stateChanged = result.status !== S.lastState || result.messageId !== S.lastMessageId;
      const progressChanged = result.progress !== (S.lastPayload?.progress ?? null);
      const shouldForceEvent = stateChanged || crossedStablePause || prefill.attempted;

      if (!S.initializedBaseline) {
        S.initializedBaseline = true;
        S.lastState = result.status;
        S.lastMessageId = result.messageId;
        S.lastPayload = payloadFor(result, prefill, snap);
        if (result.manualAction || MANUAL_ACTION_STATUSES.has(result.status)) {
          emit(result, prefill, snap, { force: true, forceEvent: true, forceNotification: true });
        }
        return S.lastPayload;
      }

      if (forceEmit || shouldForceEvent || progressChanged || ["RUNNING","UNCERTAIN","STUCK_THINKING"].includes(result.status)) {
        emit(result, prefill, snap, { force: forceEmit || shouldForceEvent || progressChanged, forceEvent: shouldForceEvent });
      } else S.lastPayload = payloadFor(result, prefill, snap);

      S.lastState = result.status; S.lastMessageId = result.messageId;
      if (!(["COMPLETE","WAITING_INPUT"].includes(result.status)) || S.terminalDeliveryConfirmed) resetRunAfterTerminal(result);
      return S.lastPayload;
    } catch (err) { reportInternalError(err); return S.lastPayload; }
  }

  async function heartbeat() {
    if (!S.managed) return;
    const response = await safeSendMessage({ type: "HEARTBEAT", status: S.lastPayload?.status || S.lastState || "IDLE", chatTitle: cleanTitle(), url: location.href, progress: S.lastPayload?.progress ?? null, progressEstimated: S.lastPayload?.progressEstimated === true, safeCompletion: S.lastPayload?.safeCompletion === true, messageId: S.lastPayload?.messageId || "", episodeId: S.episodeId, episodeRevision: S.episodeRevision, timestamp: Date.now() });
    if (response?.monitoringEnabled != null) S.monitoringEnabled = Boolean(response.monitoringEnabled);
  }

  function ensureCommandPolling() {
    if (!S.managed || S.commandTimer) return;
    S.commandTimer = setInterval(() => safeSendMessage({ type: "COMMAND_POLL" }), COMMAND_POLL_MS);
    safeSendMessage({ type: "COMMAND_POLL" });
  }

  function setCommandLeader(enabled) {
    S.commandLeader = Boolean(enabled);
    ensureCommandPolling();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "COMMAND_ROLE") { setCommandLeader(Boolean(message.leader)); return false; }
    if (message?.type === "CWN_PROBE_STATE") { const p = scan(true); sendResponse({ ok: Boolean(p), state: p || null }); return false; }
    if (message?.type === "MANUAL_ATTENTION") {
      const next = message.attention || null; const nextKey = next ? attentionEpisode(next) : "";
      if (next && S.dismissedAlertKey && S.dismissedAlertKey !== nextKey) S.dismissedAlertKey = "";
      if (!next) S.dismissedAlertKey = "";
      S.externalAttention = next;
      const current = S.lastPayload || scan(false) || { status: "UNCERTAIN", stableMs: 0 };
      renderManualAlert(current, current.resumePrefill || null); sendResponse({ ok: true }); return false;
    }
    return false;
  });

  const observer = new MutationObserver(() => { clearTimeout(S.scanTimer); S.scanTimer = setTimeout(() => scan(false), 350); });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label","data-testid","data-streaming-response-status","class","role"] });
  document.addEventListener("visibilitychange", () => scan(true)); window.addEventListener("focus", () => scan(true)); window.addEventListener("blur", () => scan(true));
  window.addEventListener("offline", () => { if (S.managed) sendState("CONNECTION_LOST", { force: true, forceEvent: true, detail: "Browser reported the network offline. Monitoring will reconnect automatically." }); });
  window.addEventListener("online", () => { if (S.managed) { S.externalAttention = null; sendState("MONITORING_RECOVERED", { force: true, forceEvent: true, detail: "Browser network connection returned." }); scan(true); } });
  setInterval(() => scan(false), SCAN_FALLBACK_MS); setInterval(heartbeat, HEARTBEAT_MS);

  setTimeout(async () => {
    await registerManagedWindow();
    if (!S.managed) return;
    // Establish the historical-page baseline before any further await. MutationObserver and
    // focus callbacks may otherwise classify a hydrated old user turn as a newly sent prompt.
    S.generationObserved = false;
    S.runStartedAt = null;
    S.currentPrompt = "";
    S.baselineUserSignature = responseSignature(latestUserText());
    S.baselineReady = true;
    const settings = await safeSendMessage({ type: "GET_SETTINGS" });
    if (settings?.runtimeConfig?.monitoringEnabled != null) S.monitoringEnabled = Boolean(settings.runtimeConfig.monitoringEnabled);
    const snap = snapshot(); S.lastFingerprint = [snap.messageId, snap.assistantText, snap.errorText, snap.workedText].join("|"); S.lastFingerprintAt = Date.now();
    scan(false); await heartbeat();
    ensureCommandPolling();
  }, 900);
})();
