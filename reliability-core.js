(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CWNCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
  const TERMINAL = new Set(["COMPLETE", "WAITING_INPUT", "PAUSED", "STUCK_THINKING", "TIMEOUT", "UNCERTAIN", "PAGE_STALE", "RECOVERY_FAILED", "FAILED", "CONNECTION_LOST"]);
  const LOGICAL_TERMINAL = new Set(["COMPLETE", "FAILED"]);

  function terminalEventId(episodeId) {
    const id = String(episodeId || "").trim();
    return id ? `completion:${id}` : null;
  }

  function shouldAcceptEpisodeUpdate(previous, next) {
    if (!next) return false;
    if (!previous) return true;
    if (previous.episodeId && next.episodeId && previous.episodeId !== next.episodeId) return true;
    const priorRevision = Number(previous.episodeRevision || 0);
    const nextRevision = Number(next.episodeRevision || 0);
    if (priorRevision && nextRevision && nextRevision < priorRevision) return false;
    if (LOGICAL_TERMINAL.has(previous.episodeState || previous.status) && !next.newEpisode && next.status !== "RUNNING") return false;
    return true;
  }

  function isChatGptUrl(value) {
    try {
      const u = new URL(String(value || ""));
      return u.protocol === "https:" && CHATGPT_HOSTS.has(u.hostname);
    } catch (_) {
      return false;
    }
  }

  function conversationIdentity(value) {
    try {
      const u = new URL(String(value || ""));
      const match = u.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
      return match ? match[1].slice(0, 96) : null;
    } catch (_) {
      return null;
    }
  }

  function shouldNotifyTransition(previous, next, now, cooldownMs) {
    if (!next || !TERMINAL.has(next.status)) return false;
    if (!previous) return true;
    if (previous.status !== next.status) return true;
    const last = Number(previous.lastNotifiedAt || 0);
    return Boolean(next.forceNotification && now - last >= cooldownMs);
  }

  function recoveryStage(input) {
    const h = input || {};
    if (!h.chromeAlive) return "WINDOW_RECOVERY";
    if (!h.bridgeOnline) return "BRIDGE_RECONNECT";
    if (!h.extensionFresh) return "EXTENSION_RECONNECT";
    if (!h.tabPresent) return "TAB_REATTACH";
    if (h.chromeHung && !h.validResponseRunning) return "WINDOW_RECOVERY";
    if (h.pageStale && h.safeReloadAllowed && !h.validResponseRunning) return "CONTROLLED_RELOAD";
    return "HEALTHY";
  }

  function dedupeSwitches(items) {
    const result = [];
    const seen = new Set();
    for (const raw of items || []) {
      const arg = String(raw || "").trim();
      if (!arg) continue;
      const key = arg.startsWith("--") ? arg.split("=", 1)[0].toLowerCase() : arg.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(arg);
    }
    return result;
  }

  return { CHATGPT_HOSTS, TERMINAL, LOGICAL_TERMINAL, isChatGptUrl, conversationIdentity, terminalEventId, shouldAcceptEpisodeUpdate, shouldNotifyTransition, recoveryStage, dedupeSwitches };
});
