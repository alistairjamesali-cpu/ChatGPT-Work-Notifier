importScripts("reliability-core.js");

const VERSION = "2.4.0";
const BRIDGE = "http://127.0.0.1:38765";
const HEALTH_ALARM = "cwn-health";
const STALE_HEARTBEAT_MS = 90 * 1000;
const REFRESH_COOLDOWN_MS = 15 * 60 * 1000;
const REFRESH_WINDOW_MS = 6 * 60 * 60 * 1000;
const REFRESH_MAX_PER_WINDOW = 4;
const MANUAL_ACTION_STATUSES = new Set(["PAUSED","STUCK_THINKING","WAITING_INPUT","FAILED"]);
const DEFAULT_SETTINGS = {
  autoResume: true,
  enabled: true,
  mode: "work",
  notifyComplete: true,
  notifyWaiting: true,
  notifyPaused: true,
  notifyStuckThinking: true,
  notifyUncertain: true,
  notifyTimeout: true,
  notifyStale: true,
  notifyFailed: true,
  notifyConnectionLost: true,
  notifyRecovered: true,
  notifyStarted: false,
  onlyWhenUnfocused: true,
  minRunSeconds: 8,
  cooldownSeconds: 8,
  persistentImportant: true
};

// Lifecycle authority is intentionally kept separate from the page's transient DOM
// observation.  These helpers are pure and bounded so a suspended MV3 worker can
// reconstruct the same episode/outbox state from chrome.storage.local.
let episodeNonce = 0;
function newEpisodeId(tabId, conversationId) {
  episodeNonce = (episodeNonce + 1) % 1000000;
  const scope = String(conversationId || "conversation").replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "conversation";
  return `episode:${Number(tabId)}:${Date.now().toString(36)}:${episodeNonce.toString(36)}:${scope}`;
}
function terminalStatus(status) { return status === "COMPLETE" || status === "FAILED"; }
function normalizeTerminal(message) {
  const out = { ...message };
  if (out.status === "COMPLETE" && out.safeCompletion === true) out.progress = 100;
  if (out.status === "COMPLETE" && out.safeCompletion !== true) {
    out.status = "UNCERTAIN"; out.safeCompletion = false; out.progress = null;
  }
  if (out.status !== "COMPLETE") out.safeCompletion = false;
  return out;
}

let commandLeaderTabId = null;
let runtimeConfigCache = { at: 0, value: null };
const volatileCooldowns = new Map();
let localMutationQueue = Promise.resolve();
let leaderElectionQueue = Promise.resolve();
let tabInventoryQueue = Promise.resolve();
let lastTabInventoryAt = 0;

// Reconcile membership, not task state. A missed close message must not leave a
// bridge-only ghost after local storage has already forgotten the tab.
function syncManagedTabInventory(force = false) {
  const run = tabInventoryQueue.then(async () => {
    if (!force && Date.now() - lastTabInventoryAt < 5000) return;
    lastTabInventoryAt = Date.now();
    const data = await chrome.storage.local.get({ managedWindowId: null, managedSessionToken: null, pendingTabInventoryToken: null });
    const token = data.managedSessionToken || data.pendingTabInventoryToken;
    if (!token) return;
    let liveTabs = [];
    if (data.managedWindowId != null && data.managedSessionToken) {
      // Query all tabs so a window that vanished without onRemoved yields an
      // authoritative empty inventory. A rejected query is never an empty list.
      liveTabs = (await chrome.tabs.query({})).filter(tab => tab.windowId === data.managedWindowId && CWNCore.isChatGptUrl(tab.url || ""));
    }
    const tabIds = liveTabs.map(tab => tab.id).filter(Number.isInteger);
    const ids = new Set(tabIds);
    const stillCurrent = await withLocalMutation(async () => {
      const current = await chrome.storage.local.get({ managedWindowId: null, managedSessionToken: null, tabs: {} });
      if (current.managedWindowId !== data.managedWindowId || current.managedSessionToken !== data.managedSessionToken) return false;
      const tabs = current.tabs || {};
      for (const id of Object.keys(tabs)) if (!ids.has(Number(id))) delete tabs[id];
      await chrome.storage.local.set({ tabs });
      return true;
    });
    if (!stillCurrent) return;
    await bridgeFetch("/browser-tabs-sync", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabIds })
    }, 900, token);
    await withLocalMutation(async () => {
      const current = await chrome.storage.local.get({ pendingTabInventoryToken: null });
      if (current.pendingTabInventoryToken === token) await chrome.storage.local.set({ pendingTabInventoryToken: null });
    });
  });
  tabInventoryQueue = run.catch(() => {});
  // The health alarm and live polling retry failures, even if no tab remains.
  return run.catch(() => {});
}

function withLocalMutation(work) {
  const run = localMutationQueue.then(() => work(), () => work());
  localMutationQueue = run.catch(() => {});
  return run;
}

async function afterLocalMutations() {
  try { await localMutationQueue; } catch (_) {}
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...current });
  const local = await chrome.storage.local.get({
    events: [], tabs: {}, managedWindowId: null, managedSessionToken: null,
    bridgeConnected: false, lastBridgeContactAt: null, completionOutbox: {}
  });
  await chrome.storage.local.set(local);
  await ensureHealthAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureHealthAlarm();
  await scanAndProtectManagedTabs();
  await electCommandLeader();
  await retryPendingCompletionOutbox();
});

async function ensureHealthAlarm() {
  const existing = await chrome.alarms.get(HEALTH_ALARM);
  if (!existing) chrome.alarms.create(HEALTH_ALARM, { periodInMinutes: 1 });
}

async function getSettings() {
  return await chrome.storage.sync.get(DEFAULT_SETTINGS);
}

async function bridgeFetch(path, options = {}, timeoutMs = 1200, tokenOverride = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let token = tokenOverride;
    if (!token) {
      const local = await chrome.storage.local.get({ managedSessionToken: null });
      token = local.managedSessionToken;
    }
    const headers = new Headers(options.headers || {});
    if (token && /^[a-f0-9]{32}$/i.test(String(token))) headers.set("X-CWN-Token", String(token));
    const response = await fetch(`${BRIDGE}${path}`, { cache: "no-store", ...options, headers, signal: controller.signal });
    if (!response.ok) throw new Error(`bridge-http-${response.status}`);
    const json = await response.json();
    await chrome.storage.local.set({ bridgeConnected: true, lastBridgeContactAt: Date.now() });
    return json;
  } catch (error) {
    await chrome.storage.local.set({ bridgeConnected: false });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getRuntimeConfig(force = false) {
  const now = Date.now();
  if (!force && runtimeConfigCache.value && now - runtimeConfigCache.at < 5000) return runtimeConfigCache.value;
  try {
    const result = await bridgeFetch("/config", {}, 900);
    runtimeConfigCache = { at: now, value: result.config || {} };
  } catch (_) {
    if (!runtimeConfigCache.value) {
      runtimeConfigCache = {
        at: now,
        value: {
          monitoringEnabled: true,
          allowControlledStaleRecovery: true,
          autoRepairConnection: true
        }
      };
    }
  }
  return runtimeConfigCache.value;
}

function statusLabel(status) {
  return ({
    RUNNING: "ChatGPT is working",
    COMPLETE: "Response ready",
    WAITING_INPUT: "ChatGPT needs you",
    PAUSED: "Work paused — Resume needed",
    STUCK_THINKING: "ChatGPT is stuck on Thinking",
    TIMEOUT: "ChatGPT message timed out",
    UNCERTAIN: "ChatGPT needs manual verification",
    PAGE_STALE: "ChatGPT monitor is stale",
    RECOVERY_FAILED: "ChatGPT recovery needs you",
    RECOVERED: "Monitoring recovered",
    MONITORING_RECOVERED: "Monitoring recovered",
    CONNECTION_LOST: "Connection lost",
    FAILED: "ChatGPT hit a problem",
    IDLE: "ChatGPT idle"
  })[status] || "ChatGPT update";
}

function badgeFor(status) {
  return ({
    RUNNING: ["…", "#2563EB"], COMPLETE: ["✓", "#2563EB"],
    WAITING_INPUT: ["?", "#D97706"], PAUSED: ["Ⅱ", "#D97706"],
    STUCK_THINKING: ["!", "#D97706"], UNCERTAIN: ["?", "#D97706"],
    TIMEOUT: ["!", "#DC2626"], PAGE_STALE: ["!", "#DC2626"], RECOVERY_FAILED: ["!", "#DC2626"],
    RECOVERED: ["✓", "#2563EB"], MONITORING_RECOVERED: ["✓", "#2563EB"], CONNECTION_LOST: ["!", "#DC2626"],
    FAILED: ["!", "#DC2626"], IDLE: ["", "#2563EB"]
  })[status] || ["", "#2563EB"];
}

async function setBadge(status) {
  const [text, color] = badgeFor(status);
  await chrome.action.setBadgeText({ text });
  if (text) await chrome.action.setBadgeBackgroundColor({ color });
}

function notificationMessage(message) {
  const progress = message.progress != null ? ` • ${message.progress}%${message.progressEstimated ? " estimated" : ""}` : "";
  const duration = message.runSeconds ? ` • ${Math.round(message.runSeconds)}s` : "";
  const title = message.chatTitle || "ChatGPT";
  const resume = /^(?:Autopilot|Resume sent)/.test(message.resumePrefill?.reason || "") ? ` • ${message.resumePrefill.reason}` : message.resumePrefill?.ok ? " • ‘Resume’ is pre-filled; click Send manually" : "";
  switch (message.status) {
    case "COMPLETE": return `${title}${progress}${duration} • completion gate passed`;
    case "WAITING_INPUT": return `${title} • reply, confirmation, choice, or upload is required`;
    case "PAUSED": return `${title}${progress} • work paused${resume || " • type Resume and send manually"}`;
    case "STUCK_THINKING": return `${title}${progress} • Thinking is stuck with no active Stop control${resume}`;
    case "TIMEOUT": return `${title}${progress} • delivery timed out; completion blocked; safe recovery check queued if allowed`;
    case "UNCERTAIN": return `${title}${progress} • response stopped without reliable completion evidence; verify manually`;
    case "PAGE_STALE": return `${title}${progress} • monitor heartbeat is stale; completion blocked`;
    case "RECOVERY_FAILED": return `${title} • safe recovery did not clear the fault; recover manually`;
    case "RECOVERED":
    case "MONITORING_RECOVERED": return `${title} • background monitoring is healthy again`;
    case "CONNECTION_LOST": return `${title} • local monitoring connection was interrupted`;
    case "FAILED": return `${title} • open the chat to inspect or retry`;
    case "RUNNING": return `${title}${progress}`;
    default: return title;
  }
}

function enabledForStatus(status, settings) {
  if (MANUAL_ACTION_STATUSES.has(status)) return true;
  return ({
    COMPLETE: settings.notifyComplete,
    RECOVERED: settings.notifyRecovered,
    MONITORING_RECOVERED: settings.notifyRecovered,
    RUNNING: settings.notifyStarted
  })[status] ?? false;
}

function shouldNotifyForMode(message, settings) {
  if (MANUAL_ACTION_STATUSES.has(message.status)) return true;
  if (settings.mode === "all") return true;
  if (["RECOVERED", "MONITORING_RECOVERED"].includes(message.status)) return true;
  return Boolean(message.workLike || (message.runSeconds || 0) >= settings.minRunSeconds);
}

async function getManagedState() {
  await afterLocalMutations();
  return await chrome.storage.local.get({ managedWindowId: null, managedSessionToken: null, tabs: {}, events: [], completionOutbox: {} });
}

async function isManagedSender(sender) {
  if (sender.tab?.id == null || sender.tab?.windowId == null) return false;
  const data = await getManagedState();
  try {
    const live = await chrome.tabs.get(sender.tab.id);
    return data.managedWindowId != null && live.windowId === data.managedWindowId &&
      sender.tab.windowId === live.windowId && sender.tab.url === live.url && CWNCore.isChatGptUrl(live.url || "");
  } catch (_) { return false; }
}

async function protectTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!CWNCore.isChatGptUrl(tab.url)) return { supported: true, protected: false, reason: "not-chatgpt" };
    await chrome.tabs.update(tabId, { autoDiscardable: false });
    const verified = await chrome.tabs.get(tabId);
    return { supported: true, protected: verified.autoDiscardable === false, discarded: Boolean(verified.discarded) };
  } catch (error) {
    return { supported: false, protected: false, reason: String(error?.message || error) };
  }
}

async function updateTabRecord(tabId, patch) {
  return await withLocalMutation(async () => {
    const data = await chrome.storage.local.get({ tabs: {} });
    const tabs = data.tabs || {};
    const key = String(tabId);
    tabs[key] = { ...(tabs[key] || {}), ...patch, tabId, updatedAt: Date.now() };
    await chrome.storage.local.set({ tabs });
    return tabs[key];
  });
}

async function removeTabRecord(tabId, reconcile = true) {
  const removed = await withLocalMutation(async () => {
    const data = await chrome.storage.local.get({ tabs: {} });
    const tabs = data.tabs || {};
    const key = String(tabId);
    const existed = Boolean(tabs[key]);
    delete tabs[key];
    await chrome.storage.local.set({ tabs });
    return existed;
  });
  if (reconcile) await syncManagedTabInventory(true);
  return removed;
}

async function scanAndProtectManagedTabs() {
  const data = await getManagedState();
  if (!data.managedSessionToken || data.managedWindowId == null) { await syncManagedTabInventory(true); return []; }
  let tabs = [];
  try { tabs = await chrome.tabs.query({ windowId: data.managedWindowId }); }
  catch (_) { await syncManagedTabInventory(true); return []; }
  const eligibleTabs = tabs.filter(tab => CWNCore.isChatGptUrl(tab.url || ""));
  const eligibleIds = new Set(eligibleTabs.map(tab => tab.id));
  for (const [key, record] of Object.entries(data.tabs || {})) {
    const tabId = Number.isInteger(record?.tabId) ? record.tabId : Number(key);
    if (!Number.isInteger(tabId) || eligibleIds.has(tabId)) continue;
    await removeTabRecord(tabId, false);
    try {
      await bridgeFetch("/browser-tab-closed", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId, reason: "managed-scan-prune" })
      }, 900);
    } catch (_) {}
    if (commandLeaderTabId === tabId) commandLeaderTabId = null;
  }
  const results = [];
  for (const tab of eligibleTabs) {
    const protection = await protectTab(tab.id);
    await updateTabRecord(tab.id, {
      windowId: tab.windowId,
      url: tab.url || "",
      conversationId: CWNCore.conversationIdentity(tab.url),
      // The content script resolves the current conversation name from ChatGPT's selected
      // sidebar item. Do not overwrite that more precise name during periodic tab scans.
      title: (data.tabs[String(tab.id)] || {}).title || tab.title || "ChatGPT",
      monitoringState: "CONNECTED",
      generationState: (data.tabs[String(tab.id)] || {}).generationState || "IDLE",
      lastHeartbeat: (data.tabs[String(tab.id)] || {}).lastHeartbeat || null,
      lastStateChange: (data.tabs[String(tab.id)] || {}).lastStateChange || null,
      notificationState: (data.tabs[String(tab.id)] || {}).notificationState || null,
      autoDiscardableProtected: protection.protected,
      discarded: Boolean(protection.discarded)
    });
    results.push({ tabId: tab.id, ...protection });
  }
  await syncManagedTabInventory(true);
  return results;
}

async function addEvent(message, notified) {
  const protection = message.autoDiscardableProtected != null
    ? { protected: Boolean(message.autoDiscardableProtected), discarded: Boolean(message.discarded) }
    : await protectTab(message.tabId);
  return await withLocalMutation(async () => {
    const data = await chrome.storage.local.get({ events: [], tabs: {} });
    const events = data.events || [];
    const tabs = data.tabs || {};
    const previous = tabs[String(message.tabId)] || {};
    const conversationId = message.conversationId || CWNCore.conversationIdentity(message.url) || previous.conversationId || null;
    const suppliedRevision = Number(message.episodeRevision || 0);
    if (previous.episodeId && message.episodeId && previous.episodeId === message.episodeId && suppliedRevision > 0 && suppliedRevision < Number(previous.episodeRevision || 0)) {
      return { previous, current: previous, changed: false, newTask: false, staleRevision: true, terminalEventId: previous.terminalEventId || null, outbox: (data.completionOutbox || {})[previous.terminalEventId] || null };
    }
    const sameConversation = !previous.conversationId || !conversationId || previous.conversationId === conversationId;
    const continuation = message.resumeContinuation === true || (previous.status === "PAUSED" && message.status === "RUNNING" && message.isResume === true);
    const explicitEpisodeChange = Boolean(previous.episodeId && message.episodeId && previous.episodeId !== message.episodeId);
    const newTask = Boolean(message.newEpisode) || explicitEpisodeChange || !sameConversation || (!continuation && previous.episodeState && terminalStatus(previous.episodeState) && message.status === "RUNNING") || (!previous.episodeId);
    const episodeId = newTask ? newEpisodeId(message.tabId, conversationId) : previous.episodeId;
    const segmentId = message.segmentId || message.messageId || previous.currentSegmentId || null;
    const requested = normalizeTerminal({ ...message });
    // A terminal episode is monotonic.  Heartbeats and historical scans can refresh
    // executionState/freshness, but cannot replace its logical outcome or event.
    const terminalSameEpisode = previous.episodeState === "COMPLETE" && !newTask;
    const effectiveStatus = terminalSameEpisode ? "COMPLETE" : requested.status;
    const effectiveProgress = effectiveStatus === "COMPLETE" && previous.safeCompletion === true || (effectiveStatus === "COMPLETE" && requested.safeCompletion === true)
      ? 100 : (terminalSameEpisode ? 100 : (requested.progress ?? null));
    const effectiveSafe = effectiveStatus === "COMPLETE" ? (terminalSameEpisode || requested.safeCompletion === true) : false;
    const changed = previous.status !== effectiveStatus || previous.episodeId !== episodeId;
    const now = Date.now();

    if ((changed || message.forceEvent) && !(terminalSameEpisode && previous.status === "COMPLETE")) {
      events.unshift({
        at: now,
        tabId: message.tabId,
        windowId: message.windowId,
        status: effectiveStatus,
        title: message.chatTitle || "ChatGPT",
        progress: effectiveProgress,
        runSeconds: message.runSeconds ?? null,
        detail: message.detail || null,
        episodeId,
        segmentId,
        terminalEventId: effectiveStatus === "COMPLETE" && effectiveSafe ? `completion:${episodeId}` : null
      });
      if (events.length > 100) events.length = 100;
    }

    const existingEventId = previous.terminalEventId || null;
    const terminalEventId = effectiveStatus === "COMPLETE" && effectiveSafe ? (existingEventId || `completion:${episodeId}`) : (terminalSameEpisode ? existingEventId : null);
    const outbox = data.completionOutbox || {};
    if (effectiveStatus === "COMPLETE" && effectiveSafe && !outbox[terminalEventId]) {
      outbox[terminalEventId] = { eventId: terminalEventId, episodeId, tabId: message.tabId, status: "COMPLETE", progress: 100, deliveryState: "pending", attempts: 0, createdAt: now, updatedAt: now };
    }
    const executionState = terminalSameEpisode ? (requested.status || "IDLE") : requested.status;
    const suppressNotification = Boolean(previous.currentSegmentId && String(previous.currentSegmentId).startsWith("new-task-") && !message.messageId && effectiveStatus === "COMPLETE");
    // Compatibility note: legacy notification markers are cleared for a new run
    // (the former expression was `changed && message.status === "RUNNING" ? null`).
    // Terminal correctness now comes from completionOutbox/event IDs; legacy branch
    // `message.status === "COMPLETE" ? null` is intentionally superseded.
    const record = {
      ...previous,
      tabId: message.tabId,
      windowId: message.windowId,
      url: message.url || previous.url || "",
      conversationId,
      episodeId,
      episodeState: effectiveStatus,
      executionState,
      currentSegmentId: segmentId,
      episodeRevision: Math.max(Number(previous.episodeRevision || 0) + 1, Number(message.episodeRevision || 0)),
      title: message.chatTitle || previous.title || "ChatGPT",
      status: effectiveStatus,
      generationState: executionState,
      monitoringState: "CONNECTED",
      progress: effectiveProgress,
      progressEstimated: effectiveStatus !== "COMPLETE" && message.progressEstimated === true,
      activeProgress: terminalSameEpisode ? null : (requested.progress ?? null),
      lastEpisodeProgress: newTask ? null : (requested.progress != null && requested.status !== "COMPLETE" ? requested.progress : (previous.lastEpisodeProgress ?? null)),
      safeCompletion: effectiveSafe,
      terminalOutcome: effectiveStatus === "COMPLETE" && effectiveSafe ? "SUCCESS" : (previous.terminalOutcome || null),
      terminalProgress: effectiveStatus === "COMPLETE" && effectiveSafe ? 100 : (previous.terminalProgress ?? null),
      terminalAt: effectiveStatus === "COMPLETE" && effectiveSafe ? (previous.terminalAt || now) : (terminalSameEpisode ? previous.terminalAt : null),
      terminalEventId,
      resumeEligible: Boolean(message.resumeEligible) && !terminalSameEpisode,
      resumeFromSegmentId: continuation ? (previous.currentSegmentId || previous.resumeFromSegmentId || null) : (message.status === "PAUSED" ? segmentId : previous.resumeFromSegmentId || null),
      suppressNotification,
      workLike: message.workLike ?? (newTask ? false : (previous.workLike ?? false)),
      runSeconds: message.runSeconds ?? (newTask ? null : (previous.runSeconds ?? null)),
      manualAction: Boolean(message.manualAction),
      messageId: message.messageId || previous.messageId || null,
      resumePrefill: message.resumePrefill || null,
      pageFocused: Boolean(message.pageFocused),
      lastHeartbeat: now,
      lastStateChange: changed ? now : (previous.lastStateChange || now),
      // A new RUNNING episode must not inherit the prior run's COMPLETE marker.
      // Keep same-status manual delivery state for cooldown/deduplication, but clear
      // stale terminal notification state at the start of a fresh generation.
      notificationState: notified ? effectiveStatus : (newTask && effectiveStatus === "RUNNING" ? null : (effectiveStatus === "COMPLETE" ? (previous.notificationState || null) : (previous.notificationState || null))),
      lastNotifiedAt: notified ? now : (previous.lastNotifiedAt || null),
      autoDiscardableProtected: protection.protected,
      discarded: Boolean(protection.discarded),
      updatedAt: now
    };
    tabs[String(message.tabId)] = record;
    // Atomic legacy shape: await chrome.storage.local.set({ events, tabs });
    // The outbox is committed in the same storage.set transaction below.
    await chrome.storage.local.set({ events, tabs, completionOutbox: outbox });
    return { previous, current: record, changed, newTask, terminalEventId, suppressNotification, outbox: terminalEventId ? outbox[terminalEventId] : null };
  });
}

async function markOutboxDelivery(eventId, state, detail = null) {
  if (!eventId) return;
  await withLocalMutation(async () => {
    const data = await chrome.storage.local.get({ completionOutbox: {}, tabs: {} });
    const outbox = data.completionOutbox || {};
    const item = outbox[eventId];
    if (!item) return;
    // Overlapping requests can finish out of order; an acknowledged delivery
    // must never become retryable because an older attempt failed later.
    if (item.deliveryState === "primary_acknowledged" ||
        (item.deliveryState === "delivered" && state !== "primary_acknowledged")) return;
    item.deliveryState = state;
    item.attempts = Number(item.attempts || 0) + 1;
    item.updatedAt = Date.now();
    item.lastError = detail || null;
    if (state === "delivered" || state === "primary_acknowledged") item.deliveredAt = item.deliveredAt || Date.now();
    const tabs = data.tabs || {};
    const tab = tabs[String(item.tabId)];
    if (tab && tab.episodeId === item.episodeId && tab.terminalEventId === eventId &&
        (state === "delivered" || state === "primary_acknowledged")) { tab.notificationState = "COMPLETE"; tab.updatedAt = Date.now(); }
    await chrome.storage.local.set({ completionOutbox: outbox, tabs });
  });
}

async function retryPendingCompletionOutbox() {
  const config = await getRuntimeConfig();
  if (config.monitoringEnabled === false) return;
  const data = await chrome.storage.local.get({ completionOutbox: {}, tabs: {} });
  for (const item of Object.values(data.completionOutbox || {})) {
    if (!item || !["pending", "failed_retryable", "offered", "deferred_focus"].includes(item.deliveryState)) continue;
    const tab = data.tabs?.[String(item.tabId)];
    if (!tab || tab.episodeId !== item.episodeId || tab.terminalEventId !== item.eventId ||
        tab.status !== "COMPLETE" || tab.safeCompletion !== true) continue;
    const settings = await getSettings();
    if (!settings.enabled || settings.notifyComplete === false) { await markOutboxDelivery(item.eventId, "policy_disabled"); continue; }
    if (tab.suppressNotification || !shouldNotifyForMode(tab, settings)) continue;
    if (settings.onlyWhenUnfocused && tab.pageFocused) { await markOutboxDelivery(item.eventId, "deferred_focus"); continue; }
    try {
      await forwardBrowserEvent({ ...tab, status: "COMPLETE", progress: 100, safeCompletion: true, terminalEventId: item.eventId, episodeId: item.episodeId, segmentId: tab.currentSegmentId, episodeRevision: tab.episodeRevision }, true);
      await markOutboxDelivery(item.eventId, "delivered");
    } catch (error) {
      await markOutboxDelivery(item.eventId, "failed_retryable", String(error?.message || error));
    }
  }
}

async function alertEligibility(message) {
  const settings = await getSettings();
  const config = await getRuntimeConfig();
  if (!settings.enabled || config.monitoringEnabled === false) return false;
  const manual = MANUAL_ACTION_STATUSES.has(message.status);
  if (!enabledForStatus(message.status, settings)) return false;
  if (!manual && !shouldNotifyForMode(message, settings)) return false;
  if (!manual && settings.onlyWhenUnfocused && message.pageFocused) return false;
  if (message.suppressNotification) return false;

  if (message.terminalEventId) {
    const outboxData = await chrome.storage.local.get({ completionOutbox: {} });
    const outboxItem = (outboxData.completionOutbox || {})[message.terminalEventId];
    if (outboxItem && ["delivered", "primary_acknowledged", "policy_disabled"].includes(outboxItem.deliveryState)) return false;
  }

  const local = await chrome.storage.local.get({ tabs: {} });
  const previous = local.tabs[String(message.tabId)] || null;
  const now = Date.now();
  const cooldownMs = Math.max(1, Number(settings.cooldownSeconds) || 8) * 1000;
  const transitionCandidate = { status: message.status, forceNotification: Boolean(message.forceNotification) };
  const deliveryPending = Boolean(previous && previous.status === message.status && previous.notificationState !== message.status);
  if (!deliveryPending && !CWNCore.shouldNotifyTransition(previous, transitionCandidate, now, cooldownMs)) return false;

  const key = `${message.tabId}:${message.status}:${message.messageId || ""}`;
  const last = volatileCooldowns.get(key) || 0;
  if (!deliveryPending && now - last < cooldownMs) return false;
  if (!deliveryPending) volatileCooldowns.set(key, now);
  return true;
}

async function maybeCreateChromeNotification(message, eligible) {
  if (!eligible) return;
  const settings = await getSettings();
  const manual = MANUAL_ACTION_STATUSES.has(message.status);
  const notificationId = `chatgpt-work-${message.tabId}-${message.status}-${Date.now()}`;
  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: statusLabel(message.status),
    message: notificationMessage(message),
    contextMessage: manual ? "ChatGPT Work Notifier • ACTION REQUIRED" : "ChatGPT Work Notifier • secondary alert",
    priority: manual ? 2 : 1,
    requireInteraction: Boolean(manual || (settings.persistentImportant && ["FAILED","CONNECTION_LOST"].includes(message.status)))
  });
}

async function forwardBrowserEvent(message, showPopup) {
  return await bridgeFetch("/browser-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tabId: message.tabId,
      windowId: message.windowId,
      status: message.status,
      title: message.chatTitle || "ChatGPT",
      url: message.url || "",
      conversationId: message.conversationId || CWNCore.conversationIdentity(message.url),
      progress: message.progress ?? null,
      progressEstimated: message.progressEstimated === true && message.status !== "COMPLETE",
      runSeconds: message.runSeconds ?? null,
      showPopup: Boolean(showPopup),
      autoDiscardableProtected: Boolean(message.autoDiscardableProtected),
      discarded: Boolean(message.discarded),
      transient: Boolean(message.transient),
      safeCompletion: Boolean(message.safeCompletion),
      manualAction: Boolean(message.manualAction),
      episodeId: message.episodeId || null,
      segmentId: message.segmentId || message.messageId || null,
      episodeRevision: Number(message.episodeRevision || 0),
      eventId: message.terminalEventId || null,
      at: Date.now()
    })
  }, 1000);
}

async function forwardHeartbeat(tab, payload = {}) {
  const before = await chrome.storage.local.get({ tabs: {} });
  const previousRecord = before.tabs?.[String(tab.id)] || {};
  const previousStatus = previousRecord.status || null;
  const protection = await protectTab(tab.id);
  const now = Date.now();
  const claimedStatus = payload.status || "IDLE";
  const safeCompletion = claimedStatus === "COMPLETE" && payload.safeCompletion === true;
  const status = claimedStatus === "COMPLETE" && !safeCompletion ? "UNCERTAIN" : claimedStatus;
  let progress = claimedStatus === "COMPLETE" && !safeCompletion ? null : (status === "COMPLETE" ? 100 : (payload.progress ?? null));
  // Preserve the explicit heartbeat proof field (`safeCompletion,`) as part of the
  // transport contract; terminal normalization below is authoritative.
  // Heartbeats carry execution freshness only. They cannot downgrade an already
  // committed terminal episode unless an explicit new episode identity is supplied.
  const sameTerminal = previousRecord.episodeState === "COMPLETE" && payload.episodeId && payload.episodeId === previousRecord.episodeId
    || (previousRecord.episodeState === "COMPLETE" && !payload.episodeId && (claimedStatus !== "RUNNING" || !payload.messageId || payload.messageId === previousRecord.currentSegmentId));
  const authoritativeStatus = sameTerminal ? "COMPLETE" : status;
  if (sameTerminal) progress = 100;
  await updateTabRecord(tab.id, {
    windowId: tab.windowId,
    url: tab.url || payload.url || "",
    conversationId: CWNCore.conversationIdentity(tab.url || payload.url),
    title: payload.chatTitle || tab.title || "ChatGPT",
    monitoringState: "CONNECTED",
    generationState: claimedStatus,
    status: authoritativeStatus,
    episodeState: authoritativeStatus,
    executionState: sameTerminal ? claimedStatus : status,
    episodeId: previousRecord.episodeId || payload.episodeId || newEpisodeId(tab.id, CWNCore.conversationIdentity(tab.url || payload.url)),
    episodeRevision: Math.max(Number(previousRecord.episodeRevision || 0), Number(payload.episodeRevision || 0)),
    progress,
    progressEstimated: authoritativeStatus !== "COMPLETE" && payload.progressEstimated === true,
    safeCompletion: authoritativeStatus === "COMPLETE" ? (sameTerminal || safeCompletion) : false,
    terminalProgress: authoritativeStatus === "COMPLETE" && (sameTerminal || safeCompletion) ? 100 : (previousRecord.terminalProgress || null),
    terminalEventId: previousRecord.terminalEventId || null,
    messageId: payload.messageId || "",
    pageFocused: Boolean(payload.pageFocused),
    lastHeartbeat: now,
    autoDiscardableProtected: protection.protected,
    discarded: Boolean(protection.discarded)
  });
  try {
    await bridgeFetch("/browser-heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url || payload.url || "",
        conversationId: CWNCore.conversationIdentity(tab.url || payload.url),
        title: payload.chatTitle || tab.title || "ChatGPT",
        status: authoritativeStatus,
        progress,
        progressEstimated: authoritativeStatus !== "COMPLETE" && payload.progressEstimated === true,
        safeCompletion: authoritativeStatus === "COMPLETE" ? (sameTerminal || safeCompletion) : false,
        episodeId: previousRecord.episodeId || payload.episodeId || null,
        episodeRevision: Number(previousRecord.episodeRevision || payload.episodeRevision || 0),
        eventId: previousRecord.terminalEventId || null,
        pageFocused: Boolean(payload.pageFocused),
        autoDiscardableProtected: protection.protected,
        discarded: Boolean(protection.discarded),
        at: now
      })
    }, 900);
  } catch (_) {}
  if (MANUAL_ACTION_STATUSES.has(previousStatus) && !MANUAL_ACTION_STATUSES.has(status)) {
    await clearManualAttention(tab.id);
  }
  return protection;
}

async function forwardLifecycle(tabId, event, patch = {}) {
  const data = await chrome.storage.local.get({ tabs: {}, managedWindowId: null, managedSessionToken: null });
  const tracked = data.tabs[String(tabId)];
  const chatGptCandidate = Boolean(data.managedSessionToken) && patch.windowId === data.managedWindowId && CWNCore.isChatGptUrl(patch.url || tracked?.url || "");
  if (!tracked && !chatGptCandidate) return;
  const next = await updateTabRecord(tabId, { ...patch, lifecycle: event });
  try {
    await bridgeFetch("/browser-lifecycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tabId,
        windowId: next.windowId,
        url: next.url || "",
        conversationId: next.conversationId || CWNCore.conversationIdentity(next.url),
        event,
        at: Date.now()
      })
    }, 900);
  } catch (_) {}
}

async function electCommandLeader() {
  const run = leaderElectionQueue.then(async () => {
    await afterLocalMutations();
    const data = await chrome.storage.local.get({ tabs: {}, managedWindowId: null });
    const candidates = Object.values(data.tabs || {})
      .filter(t => Number.isInteger(t.tabId) && CWNCore.isChatGptUrl(t.url))
      .sort((a, b) => a.tabId - b.tabId);
    const next = candidates.length ? candidates[0].tabId : null;
    if (next === commandLeaderTabId) {
      // Registration can elect a leader at document_start before content.js has
      // installed its listener, so reassert the role on later heartbeats.
      if (next != null) chrome.tabs.sendMessage(next, { type: "COMMAND_ROLE", leader: true }).catch(() => {});
      return next;
    }
    const previous = commandLeaderTabId;
    commandLeaderTabId = next;
    if (previous != null) chrome.tabs.sendMessage(previous, { type: "COMMAND_ROLE", leader: false }).catch(() => {});
    if (next != null) chrome.tabs.sendMessage(next, { type: "COMMAND_ROLE", leader: true }).catch(() => {});
    return next;
  }, async () => {
    await afterLocalMutations();
    return commandLeaderTabId;
  });
  leaderElectionQueue = run.catch(() => {});
  return await run;
}

async function pollBridgeCommand(senderTabId) {
  await syncManagedTabInventory();
  await afterLocalMutations();
  const state = await chrome.storage.local.get({ tabs: {} });
  const leaderTabId = Object.values(state.tabs || {})
    .filter(t => Number.isInteger(t.tabId) && CWNCore.isChatGptUrl(t.url))
    .map(t => t.tabId)
    .sort((a, b) => a - b)[0] ?? null;
  commandLeaderTabId = leaderTabId;
  if (senderTabId !== leaderTabId) return { ok: true, leader: false };
  let command;
  try {
    command = (await bridgeFetch("/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }, 900)).command;
  } catch (_) { return { ok: false, leader: true, bridge: false }; }
  if (!command?.requestId) return { ok: true, leader: true, command: false };

  let ok = false;
  let detail = "unknown-command";
  try {
    if (command.type === "ACTIVATE_TAB") {
      const tabId = Number(command.targetTabId);
      const state = await chrome.storage.local.get({ tabs: {} });
      if (!state.tabs[String(tabId)]) throw new Error("target-not-managed");
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true, autoDiscardable: false });
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      ok = true;
      detail = "tab-activated";
    } else if (command.type === "REPAIR_CONNECTION") {
      await scanAndProtectManagedTabs();
      await electCommandLeader();
      ok = true;
      detail = "connection-repaired";
    } else if (command.type === "DIAGNOSTIC_PING") {
      ok = true;
      detail = "extension-command-channel-ok";
    }
  } catch (error) {
    detail = String(error?.message || error);
  }

  try {
    await bridgeFetch("/command-ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: command.requestId, ok, detail, at: Date.now() })
    }, 900);
  } catch (_) {}
  return { ok, leader: true, command: true, detail };
}

async function requestStaleRecovery(sender, message) {
  if (!(await isManagedSender(sender))) return { ok: false, safeToReload: false, reason: "outside-managed-window" };
  return { ok: true, safeToReload: false, reason: "automatic-refresh-is-timeout-only-in-v2.4.0" };
}

async function sendManualAttention(tabId, attention) {
  try { await chrome.tabs.sendMessage(tabId, { type: "MANUAL_ATTENTION", attention }); } catch (_) {}
}

async function clearManualAttention(tabId) {
  await sendManualAttention(tabId, null);
}

async function probeTabState(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "CWN_PROBE_STATE" });
  } catch (_) { return null; }
}

async function getRefreshState() {
  return await chrome.storage.local.get({ cwnRefreshHistory: [], cwnPendingTimeoutRecovery: {} });
}

async function canRefreshNow() {
  const data = await getRefreshState();
  const now = Date.now();
  const history = (data.cwnRefreshHistory || []).map(Number).filter(t => Number.isFinite(t) && now - t < REFRESH_WINDOW_MS).sort((a,b)=>a-b);
  const recent = history.length ? history[history.length - 1] : 0;
  return { allowed: history.length < REFRESH_MAX_PER_WINDOW && (!recent || now - recent >= REFRESH_COOLDOWN_MS), history };
}

async function recordRefreshAttempt() {
  const check = await canRefreshNow();
  if (!check.allowed) return false;
  check.history.push(Date.now());
  await chrome.storage.local.set({ cwnRefreshHistory: check.history });
  return true;
}

async function scheduleTimeoutRecovery(tabId, message = {}) {
  const config = await getRuntimeConfig(true);
  if (config.monitoringEnabled === false || config.allowControlledStaleRecovery === false) return { ok: false, reason: "controlled-recovery-disabled" };
  let tab = null;
  try { tab = await chrome.tabs.get(tabId); } catch (_) {}
  if (!tab || !CWNCore.isChatGptUrl(tab.url || "")) return { ok: false, reason: "tab-not-chatgpt" };
  const conversationId = CWNCore.conversationIdentity(tab.url || "");
  const data = await getRefreshState();
  const pending = data.cwnPendingTimeoutRecovery || {};
  if (pending[String(tabId)]) return { ok: true, queued: true, reason: "already-queued" };
  const check = await canRefreshNow();
  const alarmName = `cwn-timeout-refresh-${tabId}-${Date.now()}`;
  const now = Date.now();
  let notBefore = now;
  if (!check.allowed) {
    const recent = check.history.length ? check.history[check.history.length - 1] : 0;
    const cooldownAt = recent ? recent + REFRESH_COOLDOWN_MS : now;
    const windowAt = check.history.length >= REFRESH_MAX_PER_WINDOW ? check.history[0] + REFRESH_WINDOW_MS : now;
    notBefore = Math.max(now, cooldownAt, windowAt);
  }
  pending[String(tabId)] = { alarmName, at: now, notBefore, messageId: message.messageId || "", conversationId };
  await chrome.storage.local.set({ cwnPendingTimeoutRecovery: pending });
  chrome.alarms.create(alarmName, { delayInMinutes: Math.max(0.2, (notBefore - now) / 60000) });
  return { ok: true, queued: true, deferred: !check.allowed, reason: check.allowed ? undefined : "rate-limit-deferred", conversationId };
}

async function clearPendingTimeout(tabId) {
  const data = await getRefreshState();
  const pending = data.cwnPendingTimeoutRecovery || {};
  const entry = pending[String(tabId)];
  if (entry?.alarmName) try { await chrome.alarms.clear(entry.alarmName); } catch (_) {}
  delete pending[String(tabId)];
  await chrome.storage.local.set({ cwnPendingTimeoutRecovery: pending });
}

async function recordOperationalFault(tabId, status, detail, progress = null) {
  let tab = null;
  try { tab = await chrome.tabs.get(tabId); } catch (_) { return; }
  const message = {
    type: "STATE", status, chatTitle: tab.title || "ChatGPT", pageFocused: false,
    progress, runSeconds: null, workLike: true, url: tab.url || "", detail,
    forceEvent: true, forceNotification: false, safeCompletion: false, manualAction: false,
    tabId, windowId: tab.windowId, conversationId: CWNCore.conversationIdentity(tab.url || "")
  };
  const protection = await protectTab(tabId);
  message.autoDiscardableProtected = protection.protected; message.discarded = Boolean(protection.discarded);
  let delivered = false;
  try { await forwardBrowserEvent(message, false); delivered = true; } catch (_) {}
  await addEvent(message, false); await setBadge(status);
  return delivered;
}

async function checkStaleHeartbeats() {
  const data = await chrome.storage.local.get({ tabs: {} });
  const now = Date.now();
  for (const rec of Object.values(data.tabs || {})) {
    if (!rec?.tabId || !CWNCore.isChatGptUrl(rec.url || "")) continue;
    const hb = Number(rec.lastHeartbeat || 0);
    if (!hb || now - hb <= STALE_HEARTBEAT_MS) continue;
    if (rec.status === "PAGE_STALE") continue;
    await recordOperationalFault(rec.tabId, "PAGE_STALE", "No fresh extension heartbeat has arrived for more than 90 seconds. Automatic connection repair remains active.", rec.progress ?? null);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "AUTOPILOT_CHECK") {
    (async () => {
      try {
        if (sender.frameId != null && sender.frameId !== 0) return sendResponse({ allowed: false });
        const tab = await chrome.tabs.get(sender.tab?.id);
        if (!(await isManagedSender({ tab })) || tab.url !== message.url) return sendResponse({ allowed: false });
        const settings = await getSettings();
        // Require live bridge health/settings before each automatic submission.
        const config = await bridgeFetch("/config", {}, 900);
        const current = await chrome.tabs.get(tab.id);
        const stillManaged = current.url === message.url && await isManagedSender({ tab: current });
        sendResponse({ allowed: stillManaged && settings.enabled !== false && settings.autoResume !== false && config.config?.monitoringEnabled === true });
      } catch (_) { sendResponse({ allowed: false }); }
    })();
    return true;
  }
  if (message?.type === "REGISTER_MANAGED_WINDOW" && sender.tab?.id != null && sender.tab?.windowId != null) {
    (async () => {
      const token = String(message.token || "");
      if (!/^[a-f0-9]{32}$/i.test(token)) return sendResponse({ ok: false, ignored: "invalid-managed-token" });
      try {
        const validation = await bridgeFetch("/validate-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token })
        }, 900, token);
        if (!validation?.ok) return sendResponse({ ok: false, ignored: "untrusted-managed-token" });
      } catch (_) {
        return sendResponse({ ok: false, ignored: "managed-token-not-confirmed" });
      }
      await withLocalMutation(async () => {
        const previous = await chrome.storage.local.get({ managedSessionToken: null, events: [], tabs: {} });
        const changedSession = Boolean(token && previous.managedSessionToken && token !== previous.managedSessionToken);
        await chrome.storage.local.set({
          managedWindowId: sender.tab.windowId,
          managedSessionToken: token,
          tabs: changedSession ? {} : (previous.tabs || {}),
          events: changedSession ? [] : (previous.events || [])
        });
      });
      await scanAndProtectManagedTabs();
      await electCommandLeader();
      sendResponse({ ok: true, managedWindowId: sender.tab.windowId, version: VERSION });
    })();
    return true;
  }

  if (message?.type === "STATE" && sender.tab?.id != null) {
    (async () => {
      if (!(await isManagedSender(sender))) return sendResponse({ ok: false, ignored: "outside-managed-window" });
      if (message.status === "COMPLETE" && message.safeCompletion !== true) {
        message = { ...message, status: "UNCERTAIN", progress: null, safeCompletion: false, manualAction: true, detail: "A completion event failed the v2.2 fail-closed completion gate. Manual verification is required." };
      }
      if (message.status !== "COMPLETE") message = { ...message, safeCompletion: false };
      const config = await getRuntimeConfig();
      if (config.monitoringEnabled === false) {
        await forwardHeartbeat(sender.tab, message);
        return sendResponse({ ok: true, paused: true });
      }
      const before = await chrome.storage.local.get({ tabs: {} });
      const previousStatus = before.tabs?.[String(sender.tab.id)]?.status || null;
      const protection = await protectTab(sender.tab.id);
      const enriched = {
        ...message,
        tabId: sender.tab.id,
        windowId: sender.tab.windowId,
        url: sender.tab.url || message.url || "",
        conversationId: CWNCore.conversationIdentity(sender.tab.url || message.url),
        autoDiscardableProtected: protection.protected,
        discarded: Boolean(protection.discarded)
      };
      // Commit the authoritative episode and completion outbox before any downstream
      // presentation attempt.  A bridge failure must never erase the terminal event.
      const committed = await addEvent(enriched, false);
      const authoritative = { ...enriched, ...committed.current, terminalEventId: committed.terminalEventId };
      const eligible = authoritative.status === "COMPLETE"
        ? await alertEligibility({ ...authoritative, forceNotification: true })
        : await alertEligibility(authoritative);
      let delivered = false;
      let responseDeliveryState = null;
      if (eligible || authoritative.status !== "COMPLETE") {
        try { await forwardBrowserEvent(authoritative, eligible); delivered = true; } catch (_) {}
      }
      if (authoritative.status === "COMPLETE" && authoritative.terminalEventId) {
        const settings = await getSettings();
        const deliveryState = settings.notifyComplete === false || settings.enabled === false
          ? "policy_disabled"
          : (delivered && eligible ? "delivered" : (eligible ? "failed_retryable" : "deferred_focus"));
        await markOutboxDelivery(authoritative.terminalEventId, deliveryState);
        responseDeliveryState = deliveryState;
      }
      const notified = eligible && delivered;
      await setBadge(authoritative.status);
      await maybeCreateChromeNotification(authoritative, notified);
      if (MANUAL_ACTION_STATUSES.has(authoritative.status)) {
        await sendManualAttention(sender.tab.id, { status: authoritative.status, kind: authoritative.status, messageId: authoritative.messageId || "", progress: authoritative.progress ?? null, detail: notificationMessage(authoritative) });
      } else if (MANUAL_ACTION_STATUSES.has(previousStatus)) {
        await clearManualAttention(sender.tab.id);
      }
      if (authoritative.status === "TIMEOUT") await scheduleTimeoutRecovery(sender.tab.id, authoritative);
      else await clearPendingTimeout(sender.tab.id);
      await electCommandLeader();
      sendResponse({ ok: true, stateCommitted: true, episodeId: authoritative.episodeId || null, episodeRevision: authoritative.episodeRevision || 0, terminalEventId: authoritative.terminalEventId || null, deliveryState: responseDeliveryState, autoDiscardableProtected: protection.protected });
    })();
    return true;
  }

  if (message?.type === "HEARTBEAT" && sender.tab?.id != null) {
    (async () => {
      if (!(await isManagedSender(sender))) return sendResponse({ ok: false, ignored: "outside-managed-window" });
      const protection = await forwardHeartbeat(sender.tab, message);
      await electCommandLeader();
      const config = await getRuntimeConfig();
      sendResponse({ ok: true, autoDiscardableProtected: protection.protected, monitoringEnabled: config.monitoringEnabled !== false });
    })();
    return true;
  }

  if (message?.type === "COMMAND_POLL" && sender.tab?.id != null) {
    pollBridgeCommand(sender.tab.id).then(sendResponse);
    return true;
  }

  if (message?.type === "REQUEST_TIMEOUT_RECOVERY" && sender.tab?.id != null) {
    (async () => {
      if (!(await isManagedSender(sender))) return sendResponse({ ok: false, reason: "outside-managed-window" });
      const state = message.state || {};
      if (state.status !== "TIMEOUT") return sendResponse({ ok: false, reason: "timeout-only" });
      sendResponse(await scheduleTimeoutRecovery(sender.tab.id, state));
    })();
    return true;
  }

  if (message?.type === "MONITOR_INTERNAL_ERROR" && sender.tab?.id != null) {
    recordOperationalFault(sender.tab.id, "RECOVERY_FAILED", `The page monitor hit an internal error: ${String(message.detail || "unknown error")}. Automatic recovery and diagnostics remain active.`).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "REQUEST_STALE_RECOVERY" && sender.tab?.id != null) {
    requestStaleRecovery(sender, message).then(sendResponse);
    return true;
  }

  if (message?.type === "GET_SETTINGS") {
    Promise.all([getSettings(), getRuntimeConfig()]).then(([settings, runtimeConfig]) => sendResponse({ ok: true, settings, runtimeConfig }));
    return true;
  }

  if (message?.type === "TEST_NOTIFICATION") {
    (async () => {
      const managed = await chrome.storage.local.get({ managedWindowId: null });
      try {
        await forwardBrowserEvent({
          tabId: -1, windowId: managed.managedWindowId, status: "TEST", chatTitle: "Test alert",
          progress: null, runSeconds: null, transient: true, url: "", conversationId: null
        }, true);
      } catch (_) {}
      try {
        await chrome.notifications.create(`chatgpt-work-test-${Date.now()}`, {
          type: "basic", iconUrl: "icons/icon128.png", title: "ChatGPT Work Notifier is ready",
          message: "The in-program popup is the primary alert. This Chrome notification is secondary.",
          contextMessage: "Test notification", priority: 1
        });
      } catch (_) {}
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === "CLEAR_BADGE") {
    chrome.action.setBadgeText({ text: "" }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.notifications.onClicked.addListener(async notificationId => {
  const match = notificationId.match(/^chatgpt-work-(\d+)-/);
  let targetTabId = null;
  if (match) targetTabId = Number(match[1]);
  try {
    await bridgeFetch("/show-managed-window", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetTabId })
    }, 900);
  } catch (_) {}
  if (targetTabId != null) {
    try {
      const local = await chrome.storage.local.get({ tabs: {} });
      if (local.tabs[String(targetTabId)]) {
        const tab = await chrome.tabs.get(targetTabId);
        await chrome.tabs.update(targetTabId, { active: true, autoDiscardable: false });
        if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      }
    } catch (_) {}
  }
  await chrome.notifications.clear(notificationId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const data = await chrome.storage.local.get({ managedWindowId: null, managedSessionToken: null, tabs: {} });
  const tracked = Boolean(data.tabs[String(tabId)]);
  const inManagedWindow = Boolean(data.managedSessionToken) && tab.windowId === data.managedWindowId && CWNCore.isChatGptUrl(changeInfo.url || tab.url || "");
  if (!tracked && !inManagedWindow) return;
  if (tracked && tab.windowId !== data.managedWindowId) {
    await forwardLifecycle(tabId, "MOVED_OUTSIDE_MANAGED_WINDOW", { windowId: tab.windowId, url: tab.url || "", monitoringState: "DETACHED" });
    await removeTabRecord(tabId);
    try {
      await bridgeFetch("/browser-tab-closed", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId, reason: "moved-outside-managed-window" })
      }, 900);
    } catch (_) {}
    if (commandLeaderTabId === tabId) commandLeaderTabId = null;
    await electCommandLeader();
    return;
  }
  if (changeInfo.url && !CWNCore.isChatGptUrl(changeInfo.url)) {
    if (tracked) {
      await forwardLifecycle(tabId, "NAVIGATED_AWAY", { windowId: tab.windowId, url: changeInfo.url, monitoringState: "DETACHED" });
      await removeTabRecord(tabId);
      try {
        await bridgeFetch("/browser-tab-closed", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId, reason: "navigated-away" })
        }, 900);
      } catch (_) {}
      if (commandLeaderTabId === tabId) commandLeaderTabId = null;
      await electCommandLeader();
    }
    return;
  }
  if (!CWNCore.isChatGptUrl(tab.url)) return;
  const protection = await protectTab(tabId);
  await forwardLifecycle(tabId, changeInfo.status === "complete" ? "PAGE_READY" : "TAB_UPDATED", {
    windowId: tab.windowId,
    url: tab.url || "",
    conversationId: CWNCore.conversationIdentity(tab.url),
    title: tab.title || "ChatGPT",
    monitoringState: "CONNECTED",
    autoDiscardableProtected: protection.protected,
    discarded: Boolean(protection.discarded)
  });
  await electCommandLeader();
});

chrome.tabs.onActivated.addListener(async activeInfo => {
  const data = await chrome.storage.local.get({ managedWindowId: null, managedSessionToken: null, tabs: {} });
  if (data.tabs[String(activeInfo.tabId)]) {
    await forwardLifecycle(activeInfo.tabId, "TAB_ACTIVATED", { windowId: activeInfo.windowId });
    return;
  }
  if (!data.managedSessionToken || activeInfo.windowId !== data.managedWindowId) return;
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (CWNCore.isChatGptUrl(tab.url || "")) {
      const protection = await protectTab(activeInfo.tabId);
      await forwardLifecycle(activeInfo.tabId, "TAB_ACTIVATED", {
        windowId: activeInfo.windowId,
        url: tab.url || "",
        conversationId: CWNCore.conversationIdentity(tab.url),
        title: tab.title || "ChatGPT",
        monitoringState: "CONNECTED",
        autoDiscardableProtected: protection.protected,
        discarded: Boolean(protection.discarded)
      });
      await electCommandLeader();
    }
  } catch (_) {}
});

chrome.tabs.onDetached.addListener(async (tabId, detachInfo) => {
  const data = await chrome.storage.local.get({ tabs: {} });
  if (data.tabs[String(tabId)]) await forwardLifecycle(tabId, "TAB_DETACHED", { windowId: detachInfo.oldWindowId, monitoringState: "MOVING" });
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  const data = await chrome.storage.local.get({ managedWindowId: null, managedSessionToken: null, tabs: {} });
  const tracked = Boolean(data.tabs[String(tabId)]);
  if (attachInfo.newWindowId !== data.managedWindowId) {
    if (tracked) {
      await forwardLifecycle(tabId, "MOVED_OUTSIDE_MANAGED_WINDOW", { windowId: attachInfo.newWindowId, monitoringState: "DETACHED" });
      await removeTabRecord(tabId);
      try {
        await bridgeFetch("/browser-tab-closed", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId, reason: "moved-outside-managed-window" })
        }, 900);
      } catch (_) {}
      if (commandLeaderTabId === tabId) commandLeaderTabId = null;
      await electCommandLeader();
    }
    return;
  }
  if (tracked || data.managedSessionToken) {
    const protection = await protectTab(tabId);
    let tab = null;
    try { tab = await chrome.tabs.get(tabId); } catch (_) {}
    if (!tab || !CWNCore.isChatGptUrl(tab.url || "")) return;
    await forwardLifecycle(tabId, "TAB_REATTACHED", {
      windowId: attachInfo.newWindowId,
      url: tab?.url || data.tabs[String(tabId)].url || "",
      monitoringState: "CONNECTED",
      autoDiscardableProtected: protection.protected,
      discarded: Boolean(protection.discarded)
    });
    await electCommandLeader();
  }
});

chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  const data = await chrome.storage.local.get({ managedWindowId: null, tabs: {} });
  const old = data.tabs[String(removedTabId)];
  if (!old) return;
  await removeTabRecord(removedTabId);
  let tab = null;
  try { tab = await chrome.tabs.get(addedTabId); } catch (_) {}
  if (!tab || tab.windowId !== data.managedWindowId) return;
  const protection = await protectTab(addedTabId);
  await updateTabRecord(addedTabId, {
    ...old,
    tabId: addedTabId,
    windowId: tab?.windowId ?? old.windowId,
    url: tab?.url || old.url || "",
    monitoringState: "RECOVERED",
    autoDiscardableProtected: protection.protected,
    discarded: Boolean(protection.discarded)
  });
  await forwardLifecycle(addedTabId, "RENDERER_REPLACED", { windowId: tab?.windowId ?? old.windowId, url: tab?.url || old.url || "" });
  await electCommandLeader();
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const data = await chrome.storage.local.get({ tabs: {} });
  if (!data.tabs[String(tabId)]) { await syncManagedTabInventory(true); return; }
  await removeTabRecord(tabId);
  try {
    await bridgeFetch("/browser-tab-closed", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabId })
    }, 900);
  } catch (_) {}
  if (commandLeaderTabId === tabId) commandLeaderTabId = null;
  await electCommandLeader();
});

chrome.windows.onRemoved.addListener(async windowId => {
  const removedManagedWindow = await withLocalMutation(async () => {
    const data = await chrome.storage.local.get({ managedWindowId: null, managedSessionToken: null, tabs: {} });
    if (data.managedWindowId !== windowId) return false;
    await chrome.storage.local.set({ managedWindowId: null, managedSessionToken: null, tabs: {}, pendingTabInventoryToken: data.managedSessionToken });
    return true;
  });
  if (removedManagedWindow) {
    await syncManagedTabInventory(true);
    await chrome.action.setBadgeText({ text: "" });
  }
  await electCommandLeader();
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === HEALTH_ALARM) {
    await scanAndProtectManagedTabs();
    await electCommandLeader();
    await checkStaleHeartbeats();
    await retryPendingCompletionOutbox();
    try { await bridgeFetch("/state", {}, 900); } catch (_) {}
    return;
  }

  let m = /^cwn-timeout-refresh-(\d+)-/.exec(alarm.name || "");
  if (m) {
    const tabId = Number(m[1]);
    const data = await getRefreshState();
    const pending = data.cwnPendingTimeoutRecovery || {};
    const recoveryEpisode = pending[String(tabId)] || null;
    if (!recoveryEpisode) return;
    if (Number(recoveryEpisode.notBefore || 0) > Date.now()) {
      chrome.alarms.create(alarm.name, { delayInMinutes: Math.max(0.2, (Number(recoveryEpisode.notBefore) - Date.now()) / 60000) });
      return;
    }
    delete pending[String(tabId)];
    await chrome.storage.local.set({ cwnPendingTimeoutRecovery: pending });
    let tab = null; try { tab = await chrome.tabs.get(tabId); } catch (_) { return; }
    if (!tab || !CWNCore.isChatGptUrl(tab.url || "")) return;
    const sameConversation = !recoveryEpisode?.conversationId || recoveryEpisode.conversationId === CWNCore.conversationIdentity(tab.url || "");
    if (!sameConversation) return;
    const probed = await probeTabState(tabId);
    const state = probed?.state || null;
    if (!state || state.status !== "TIMEOUT") return;
    if (state.hasContinueButton === true) {
      await recordOperationalFault(tabId, "RECOVERY_FAILED", "Timeout evidence remains while ChatGPT exposes a Continue control. The notifier preserved the live job and will keep monitoring it.", state.progress ?? null);
      return;
    }
    if (state.composerEmpty === false) {
      await recordOperationalFault(tabId, "RECOVERY_FAILED", "Timeout remains while text is present in the composer. The notifier preserved the draft and will keep monitoring it.", state.progress ?? null);
      return;
    }
    if (!(await recordRefreshAttempt())) {
      await recordOperationalFault(tabId, "RECOVERY_FAILED", "Timeout remains while the safe refresh rate limit is active. Automatic monitoring will retry after the limit clears.", state.progress ?? null);
      return;
    }
    try {
      await chrome.tabs.reload(tabId, { bypassCache: false });
      chrome.alarms.create(`cwn-timeout-verify-${tabId}-${Date.now()}`, { delayInMinutes: 0.25 });
    } catch (_) {
      await recordOperationalFault(tabId, "RECOVERY_FAILED", "The safe recovery refresh failed. Automatic monitoring and diagnostics remain active.", state.progress ?? null);
    }
    return;
  }

  m = /^cwn-timeout-verify-(\d+)-/.exec(alarm.name || "");
  if (m) {
    const tabId = Number(m[1]);
    const probed = await probeTabState(tabId);
    const state = probed?.state || null;
    if (state?.status === "TIMEOUT") await recordOperationalFault(tabId, "RECOVERY_FAILED", "The safe recovery reload did not clear the timeout. Automatic monitoring and diagnostics remain active.", state.progress ?? null);
  }
});

ensureHealthAlarm().catch(() => {});
scanAndProtectManagedTabs().then(electCommandLeader).catch(() => {});
