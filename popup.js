const DEFAULTS = {
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

const ids = [
  "autoResume",
  "enabled","mode","onlyWhenUnfocused","notifyComplete","notifyRecovered","minRunSeconds"
];

function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function label(status) {
  return ({
    RUNNING:"RUNNING", COMPLETE:"COMPLETED", WAITING_INPUT:"NEEDS INPUT",
    PAUSED:"PAUSED", STUCK_THINKING:"THINKING STUCK", TIMEOUT:"TIMEOUT", UNCERTAIN:"VERIFY MANUALLY",
    PAGE_STALE:"MONITOR STALE", RECOVERY_FAILED:"RECOVERY FAILED", RECOVERED:"RECOVERED",
    MONITORING_RECOVERED:"RECOVERED", CONNECTION_LOST:"CONNECTION LOST", FAILED:"ERROR", IDLE:"IDLE"
  })[status] || status;
}

async function loadBridge() {
  const bridgeEl = document.getElementById("bridgeStatus");
  const heartbeatEl = document.getElementById("heartbeatStatus");
  const tabEl = document.getElementById("tabStatus");
  const memoryEl = document.getElementById("memoryStatus");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(`http://127.0.0.1:38765/state?t=${Date.now()}`, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("offline");
    const state = await response.json();
    if (state.mode !== "CHROME_ONLY" || state.version !== "2.4.0") throw new Error("wrong mode");
    bridgeEl.textContent = "Connected";
    bridgeEl.className = "";
    const tabs = state.browser?.tabs || [];
    tabEl.textContent = String(state.browser?.tabCount ?? 0);
    const now = Date.now();
    const hb = Number(state.browser?.lastExtensionHeartbeatAt || 0);
    const age = hb ? Math.round((now - hb) / 1000) : null;
    heartbeatEl.textContent = age != null && age <= 60 ? `${age}s ago` : "Needs attention";
    heartbeatEl.className = age != null && age <= 60 ? "" : "bad";
    const memoryProtected = tabs.length === 0 || tabs.every(t => t.autoDiscardableProtected === true);
    memoryEl.textContent = memoryProtected ? "Protected" : "Needs attention";
    memoryEl.className = memoryProtected ? "" : "bad";
  } catch (_) {
    bridgeEl.textContent = "Offline";
    bridgeEl.className = "bad";
    heartbeatEl.textContent = "Unavailable";
    heartbeatEl.className = "bad";
    memoryEl.textContent = "Unavailable";
    memoryEl.className = "bad";
  } finally {
    clearTimeout(timer);
  }
}

async function load() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(settings[id]);
    else el.value = settings[id];
  }
  const local = await chrome.storage.local.get({ events: [], tabs: {} });
  const tabs = Object.values(local.tabs || {})
    .filter(t => !["DETACHED","CLOSED","PRUNED"].includes(t.monitoringState) && !["DETACHED","CLOSED","PRUNED","NAVIGATED_AWAY"].includes(t.lifecycle))
    .sort((a,b) => ((b.updatedAt || b.lastStateChange || 0) - (a.updatedAt || a.lastStateChange || 0)) || (Number(b.tabId || 0) - Number(a.tabId || 0)));
  const current = tabs[0];
  if (current) {
    const claimedStatus = current.status || current.generationState || "IDLE";
    const safeComplete = claimedStatus === "COMPLETE" && current.safeCompletion === true;
    const status = claimedStatus === "COMPLETE" && !safeComplete ? "UNCERTAIN" : claimedStatus;
    const reported = Number(current.progress);
    const validProgress = current.progress != null && Number.isFinite(reported) && reported >= 0 && reported <= 100;
    const pct = safeComplete ? 100 : (claimedStatus === "COMPLETE" ? null : (validProgress ? reported : null));
    document.getElementById("currentStatus").textContent = label(status);
    document.getElementById("currentTitle").textContent = current.title || "ChatGPT";
    document.getElementById("currentProgress").textContent = pct == null ? (status === "RUNNING" ? "Working — % unavailable" : "—") : `${pct}%${current.progressEstimated && !safeComplete ? " estimated" : ""}`;
    document.getElementById("progressFill").style.width = pct == null ? "0%" : `${pct}%`;
  }
  renderHistory(local.events || []);
  await loadBridge();
  chrome.runtime.sendMessage({ type: "CLEAR_BADGE" }).catch(() => {});
}

function renderHistory(events) {
  const host = document.getElementById("history");
  host.textContent = "";
  if (!events.length) { host.innerHTML = '<div class="muted empty">No state changes yet.</div>'; return; }
  for (const event of events.slice(0, 14)) {
    const row = document.createElement("div"); row.className = "item";
    const state = document.createElement("div"); state.className = "state"; state.textContent = label(event.status);
    const right = document.createElement("div");
    const title = document.createElement("div"); title.className = "title"; title.textContent = event.title || "ChatGPT";
    const time = document.createElement("div"); time.className = "time"; time.textContent = `${fmtTime(event.at)}${event.progress != null ? ` • ${event.progress}%` : ""}`;
    right.append(title, time); row.append(state, right); host.append(row);
  }
}

async function saveField(id) {
  const el = document.getElementById(id);
  let value = el.type === "checkbox" ? el.checked : el.value;
  if (id === "minRunSeconds") value = Math.max(1, Math.min(600, Number(value) || 8));
  await chrome.storage.sync.set({ [id]: value });
}

for (const id of ids) document.getElementById(id).addEventListener("change", () => saveField(id));
document.getElementById("test").addEventListener("click", async () => { await chrome.runtime.sendMessage({ type: "TEST_NOTIFICATION" }); });
document.getElementById("clear").addEventListener("click", async () => { await chrome.storage.local.set({ events: [] }); renderHistory([]); });
load();
