const {keys, messages} = window.TabbitContracts;
const {
  TAB_GROUP_ID_NONE,
  buildGroupingPlanFromAiGroups,
  buildGroupingPlan,
  findDuplicateTabs,
  findUnusedTabs
} = window.TabbitOrganizer;

const STORAGE_KEY = keys.sessions;
const AI_SETTINGS_KEY = keys.aiSettings;
const UI_STATE_KEY = keys.uiState;
const PLAN_KEY = keys.plan;
const PLAN_PENDING_MAX_MS = 2 * 60 * 1000;
const { DEFAULT_AI_MODEL, DEFAULT_BRIEF_MODEL, MODEL_ROUTING_VERSION, normalizeAiSettings, buildJsonRequest, hasAiAccess } = window.TabbitAiConfig;

const DEFAULT_OPTIONS = {
  collapseGroups: false,
  currentWindowOnly: true,
  includePinned: false,
  minGroupSize: 2
};

const elements = {
  aiApiKey: document.querySelector("#aiApiKey"),
  aiProvider: document.querySelector("#aiProvider"),
  aiCodexNote: document.querySelector("#aiCodexNote"),
  aiBody: document.querySelector("#aiBody"),
  aiContext: document.querySelector("#aiContext"),
  aiModel: document.querySelector("#aiModel"),
  aiBriefModel: document.querySelector("#aiBriefModel"),
  aiSummary: document.querySelector("#aiSummary"),
  aiSurface: document.querySelector(".ai-surface"),
  aiToggle: document.querySelector("#aiToggle"),
  debugExportButton: document.querySelector("#debugExportButton"),
  dedupeButton: document.querySelector("#dedupeButton"),
  duplicateCount: document.querySelector("#duplicateCount"),
  groupCount: document.querySelector("#groupCount"),
  groupPreview: document.querySelector("#groupPreview"),
  organizeButton: document.querySelector("#organizeButton"),
  refreshButton: document.querySelector("#refreshButton"),
  reorganizeButton: document.querySelector("#reorganizeButton"),
  saveSessionButton: document.querySelector("#saveSessionButton"),
  sessionCount: document.querySelector("#sessionCount"),
  sessionList: document.querySelector("#sessionList"),
  statusPill: document.querySelector("#statusPill"),
  tabCount: document.querySelector("#tabCount"),
  unusedButton: document.querySelector("#unusedButton"),
  unusedCount: document.querySelector("#unusedCount"),
  ungroupButton: document.querySelector("#ungroupButton")
};

const colorMap = {
  blue: "#2f80ed",
  cyan: "#27a7b8",
  green: "#219653",
  grey: "#7b8794",
  orange: "#f2994a",
  pink: "#eb5791",
  purple: "#9b51e0",
  red: "#eb5757",
  yellow: "#d9a400"
};

const state = {
  duplicatePlan: null,
  unusedTabs: [],
  aiSettings: null,
  groupPlan: null,
  planSource: "local",
  sessions: [],
  tabs: [],
  aiPending: null,
  aiDebug: null
};

function setKeyState(hasKey) {
  document.body.dataset.hasKey = hasKey ? "yes" : "no";
}

function renderAiSummary() {
  const model = window.TabbitAiConfig.modelsForProvider(state.aiSettings).model;
  const context = (state.aiSettings?.context || "").trim();
  const trimmedContext = context.length > 36 ? `${context.slice(0, 35).trim()}…` : context;
  elements.aiSummary.textContent = trimmedContext ? `${model} · ${trimmedContext}` : model;
}

function setAiExpanded(expanded, { persist = true } = {}) {
  const value = expanded ? "yes" : "no";
  elements.aiSurface.dataset.expanded = value;
  elements.aiToggle.setAttribute("aria-expanded", String(expanded));

  if (persist) {
    chrome.storage.local.set({ [UI_STATE_KEY]: { aiExpanded: expanded } }).catch(() => {});
  }
}

async function getStoredUiState() {
  try {
    const result = await chrome.storage.local.get(UI_STATE_KEY);
    return result[UI_STATE_KEY] || {};
  } catch (_error) {
    return {};
  }
}

function setBusy(isBusy) {
  for (const button of [
    elements.dedupeButton,
    elements.organizeButton,
    elements.refreshButton,
    elements.reorganizeButton,
    elements.saveSessionButton,
    elements.unusedButton,
    elements.ungroupButton
  ]) {
    button.disabled = isBusy;
  }
}

function setStatus(message, tone = "default") {
  elements.statusPill.textContent = message;

  if (tone === "default") {
    elements.statusPill.removeAttribute("data-tone");
    return;
  }

  elements.statusPill.dataset.tone = tone;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function getOptions() {
  return { ...DEFAULT_OPTIONS };
}

async function getTabs() {
  return chrome.tabs.query({ currentWindow: true });
}

async function getSessions() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
}

async function setSessions(sessions) {
  state.sessions = sessions;
  await chrome.storage.local.set({ [STORAGE_KEY]: sessions });
}

function tabSubtitle(tabs) {
  return tabs
    .slice(0, 3)
    .map((tab) => tab.title || tab.url)
    .join(" | ");
}

function renderPlanLoading() {
  elements.groupPreview.innerHTML = `
    <div class="group-row skeleton"><span class="skel-line skel-line-a"></span></div>
    <div class="group-row skeleton"><span class="skel-line skel-line-b"></span></div>
    <div class="group-row skeleton"><span class="skel-line skel-line-c"></span></div>
  `;
}

function renderPlan() {
  const { groups = [] } = state.groupPlan || {};

  elements.tabCount.textContent = String(state.tabs.length);
  elements.groupCount.textContent = String(groups.length);
  elements.duplicateCount.textContent = String(state.duplicatePlan?.removableTabs.length || 0);
  elements.unusedCount.textContent = String(state.unusedTabs.length);

  if (groups.length === 0) {
    elements.groupPreview.innerHTML =
      '<div class="empty">No groupable clusters yet.</div>';
    return;
  }

  elements.groupPreview.innerHTML = groups
    .map((group) => {
      const dotColor = colorMap[group.color] || colorMap.grey;
      return `
        <article class="group-row">
          <div class="row-main">
            <div class="title-wrap">
              <span class="color-dot" style="background: ${dotColor}"></span>
              <span class="row-title">${escapeHtml(group.title)}</span>
            </div>
            <span class="row-count">${group.tabs.length} tabs</span>
          </div>
          <div class="row-detail">${escapeHtml(tabSubtitle(group.tabs))}</div>
        </article>
      `;
    })
    .join("");
}

function renderSessions() {
  const count = state.sessions.length;
  elements.sessionCount.textContent = `${count} saved`;

  if (count === 0) {
    elements.sessionList.innerHTML = '<div class="empty">Saved sessions will show up here.</div>';
    return;
  }

  elements.sessionList.innerHTML = state.sessions
    .map(
      (session) => `
        <article class="session-row">
          <div class="row-main">
            <span class="row-title">${escapeHtml(session.name)}</span>
            <span class="row-count">${session.tabs.length} tabs</span>
          </div>
          <div class="row-detail">${escapeHtml(formatTime(session.createdAt))}</div>
          <div class="session-actions">
            <button class="session-action" data-session-action="restore" data-session-id="${session.id}" type="button">
              Restore
            </button>
            <button class="session-action" data-session-action="delete" data-session-id="${session.id}" type="button">
              Delete
            </button>
          </div>
        </article>
      `
    )
    .join("");
}

const {readAiSettingsFromForm, saveAiSettings, renderAiSettings, loadAiSettings} = window.createTabbitPopupSettings({state, elements, chrome, config:window.TabbitAiConfig, keys, setKeyState, setAiExpanded, replan, renderAiSummary});

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const {buildAiMessages} = window.TabbitGroupingPrompt;

// The background worker makes the call and stores the result, so a plan
// requested just before the popup closes is still there when it reopens.
async function requestAiGroups(tabs, settings, options) {
  const promptMessages = buildAiMessages(tabs, options, settings);
  const requestBody = buildJsonRequest(promptMessages, settings, "grouping");

  const plan = await chrome.runtime.sendMessage({
    type: messages.requestPlan,
    requestBody,
    tabIds: tabs.filter((tab) => window.TabbitOrganizer.isGroupableTab(tab, options)).map((tab) => tab.id),
    windowId: tabs[0]?.windowId
  });

  state.aiDebug = plan?.debug || null;

  if (plan?.status !== "done") {
    throw new Error(plan?.error || "AI request failed");
  }

  return plan.groups;
}

async function getStoredPlan() {
  const result = await chrome.storage.local.get(PLAN_KEY);
  return result[PLAN_KEY] || null;
}

function waitForStoredPlan() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), PLAN_PENDING_MAX_MS);

    function finish(plan) {
      clearTimeout(timer);
      chrome.storage.onChanged.removeListener(onChange);
      resolve(plan);
    }

    function onChange(changes) {
      const plan = changes[PLAN_KEY]?.newValue;

      if (plan && plan.status !== "running") {
        finish(plan);
      }
    }

    chrome.storage.onChanged.addListener(onChange);
  });
}

// Reuses the last AI plan instead of asking again every time the popup opens.
// Tabs opened since then are left out, and Organize asks for a fresh plan.
async function showStoredPlan() {
  let plan = await getStoredPlan();

  if (plan?.status === "running" && Date.now() - plan.startedAt < PLAN_PENDING_MAX_MS) {
    setBusy(true);
    setStatus("Asking AI");
    renderPlanLoading();
    plan = await waitForStoredPlan();
    setBusy(false);
    renderPlan();
    setStatus(plan?.status === "failed" ? "AI failed" : "Ready", plan?.status === "failed" ? "error" : "default");
  }

  const options = getOptions();
  const groupableIds = state.tabs
    .filter((tab) => window.TabbitOrganizer.isGroupableTab(tab, options))
    .map((tab) => tab.id);
  const plannedIds = new Set(plan?.tabIds || []);
  const newCount = groupableIds.filter((id) => !plannedIds.has(id)).length;

  if (plan?.status !== "done" || plan.windowId !== state.tabs[0]?.windowId || newCount === groupableIds.length) {
    return;
  }

  state.groupPlan = buildGroupingPlanFromAiGroups(state.tabs, plan.groups, options);
  state.planSource = newCount === 0 ? "openai" : "stale";
  state.aiDebug = plan.debug || null;
  renderPlan();
  setStatus(newCount === 0 ? "AI plan" : `AI plan · ${newCount} new`);
}

async function refreshLocal() {
  setBusy(true);

  try {
    state.tabs = await getTabs();
    state.groupPlan = buildGroupingPlan(state.tabs, getOptions());
    state.planSource = "local";
    state.duplicatePlan = findDuplicateTabs(state.tabs, getOptions());
    state.unusedTabs = findUnusedTabs(state.tabs, getOptions());
    state.sessions = await getSessions();
    renderPlan();
    renderSessions();
    setStatus("Ready");
  } catch (error) {
    setStatus("Error", "error");
    console.error(error);
  } finally {
    setBusy(false);
  }
}

async function _buildAiPlanInner() {
  const settings = readAiSettingsFromForm();

  if (!hasAiAccess(settings)) {
    setStatus("Need key", "warn");
    return false;
  }

  setBusy(true);
  setStatus("Asking AI");
  renderPlanLoading();

  try {
    state.tabs = await getTabs();
    const options = getOptions();
    const aiGroups = await requestAiGroups(state.tabs, settings, options);
    state.groupPlan = buildGroupingPlanFromAiGroups(state.tabs, aiGroups, options);
    state.planSource = "openai";
    state.duplicatePlan = findDuplicateTabs(state.tabs, options);
    state.unusedTabs = findUnusedTabs(state.tabs, options);
    state.sessions = await getSessions();
    state.aiSettings = settings;
    renderPlan();
    renderSessions();
    setStatus("AI plan");
    return true;
  } catch (error) {
    state.groupPlan = buildGroupingPlan(state.tabs, getOptions());
    state.planSource = "local";
    state.duplicatePlan = findDuplicateTabs(state.tabs, getOptions());
    state.unusedTabs = findUnusedTabs(state.tabs, getOptions());
    state.sessions = await getSessions();
    renderPlan();
    renderSessions();
    setStatus("AI failed", "error");
    console.error(error);
    return false;
  } finally {
    setBusy(false);
  }
}

async function buildAiPlan() {
  if (state.aiPending) {
    return state.aiPending;
  }

  state.aiPending = _buildAiPlanInner();

  try {
    return await state.aiPending;
  } finally {
    state.aiPending = null;
  }
}

async function refresh() {
  await refreshLocal();
  await showStoredPlan();
}

async function replan() {
  if (hasAiAccess(state.aiSettings)) {
    await buildAiPlan();
  } else {
    await refreshLocal();
  }
}

async function applyGroupPlan({ ungroupFirst, successStatus }) {
  const groups = state.groupPlan?.groups || [];

  if (groups.length === 0) {
    setStatus("No groups", "warn");
    return;
  }

  setBusy(true);

  try {
    if (ungroupFirst) {
      const options = getOptions();
      const groupedTabIds = state.tabs
        .filter((tab) => tab.groupId !== TAB_GROUP_ID_NONE)
        .filter((tab) => options.includePinned || !tab.pinned)
        .map((tab) => tab.id);

      if (groupedTabIds.length > 0) {
        await chrome.tabs.ungroup(groupedTabIds);
      }
    }

    for (const group of groups) {
      const tabIds = group.tabs.map((tab) => tab.id);
      const groupId = await chrome.tabs.group({
        createProperties: { windowId: group.windowId },
        tabIds
      });

      await chrome.tabGroups.update(groupId, {
        collapsed: getOptions().collapseGroups,
        color: group.color,
        title: group.title
      });
    }

    setStatus(successStatus);
    await refresh();
  } catch (error) {
    setStatus("Failed", "error");
    console.error(error);
  } finally {
    setBusy(false);
  }
}

async function organizeTabs() {
  if (state.planSource !== "openai") {
    const didBuildAiPlan = await buildAiPlan();

    if (!didBuildAiPlan) {
      return;
    }
  }

  await applyGroupPlan({ ungroupFirst: false, successStatus: "Organized" });
}

async function reorganizeTabs() {
  state.planSource = "local";
  const didBuildAiPlan = await buildAiPlan();

  if (!didBuildAiPlan) {
    return;
  }

  await applyGroupPlan({ ungroupFirst: true, successStatus: "Reorganized" });
}

async function closeDuplicateTabs() {
  if (!state.duplicatePlan) {
    await refresh();
  }

  const removableIds = state.duplicatePlan?.removableTabs.map((tab) => tab.id) || [];

  if (removableIds.length === 0) {
    setStatus("No dupes", "warn");
    return;
  }

  setBusy(true);

  try {
    await chrome.tabs.remove(removableIds);
    setStatus(`Closed ${removableIds.length}`);
    await refresh();
  } catch (error) {
    setStatus("Failed", "error");
    console.error(error);
  } finally {
    setBusy(false);
  }
}

async function closeUnusedTabs() {
  await refreshLocal();
  const removableIds = state.unusedTabs.map((tab) => tab.id);

  if (removableIds.length === 0) {
    setStatus("No unused tabs", "warn");
    return;
  }

  setBusy(true);

  try {
    await chrome.tabs.remove(removableIds);
    setStatus(`Closed ${removableIds.length}`);
    await refresh();
  } catch (error) {
    setStatus("Failed", "error");
    console.error(error);
  } finally {
    setBusy(false);
  }
}

async function ungroupTabs() {
  await refresh();

  const options = getOptions();
  const groupedTabIds = state.tabs
    .filter((tab) => tab.groupId !== TAB_GROUP_ID_NONE)
    .filter((tab) => options.includePinned || !tab.pinned)
    .map((tab) => tab.id);

  if (groupedTabIds.length === 0) {
    setStatus("No groups", "warn");
    return;
  }

  setBusy(true);

  try {
    await chrome.tabs.ungroup(groupedTabIds);
    setStatus("Ungrouped");
    await refresh();
  } catch (error) {
    setStatus("Failed", "error");
    console.error(error);
  } finally {
    setBusy(false);
  }
}

async function saveSession() {
  await refresh();

  const tabs = state.tabs
    .filter((tab) => tab.url && !tab.url.startsWith("chrome://"))
    .map((tab) => ({
      title: tab.title || tab.url,
      url: tab.url
    }));

  if (tabs.length === 0) {
    setStatus("No tabs", "warn");
    return;
  }

  const createdAt = Date.now();
  const nextSession = {
    id: crypto.randomUUID(),
    createdAt,
    name: `Session ${formatTime(createdAt)}`,
    tabs
  };

  const nextSessions = [nextSession, ...state.sessions].slice(0, 20);
  await setSessions(nextSessions);
  renderSessions();
  setStatus("Saved");
}

async function restoreSession(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);

  if (!session) {
    setStatus("Missing", "error");
    return;
  }

  const urls = session.tabs.map((tab) => tab.url).filter(Boolean);

  if (urls.length === 0) {
    setStatus("Empty", "warn");
    return;
  }

  setBusy(true);

  try {
    await chrome.windows.create({ focused: true, url: urls });
    setStatus("Restored");
  } catch (error) {
    setStatus("Failed", "error");
    console.error(error);
  } finally {
    setBusy(false);
  }
}

function buildDebugSnapshot() {
  const groupPlan = state.groupPlan
    ? {
        groups: (state.groupPlan.groups || []).map((group) => ({
          title: group.title,
          color: group.color,
          windowId: group.windowId,
          reasons: group.reasons,
          tabIds: (group.tabs || []).map((tab) => tab.id),
          tabs: (group.tabs || []).map((tab) => ({
            id: tab.id,
            title: tab.title,
            url: tab.url
          }))
        })),
        skippedCount: state.groupPlan.skippedCount,
        groupableCount: state.groupPlan.groupableCount
      }
    : null;

  const duplicatePlan = state.duplicatePlan
    ? {
        removableCount: state.duplicatePlan.removableTabs.length,
        duplicateSets: state.duplicatePlan.duplicateSets.map((set) => ({
          url: set.url,
          keeperId: set.keeper?.id,
          removableIds: set.removableTabs.map((tab) => tab.id),
          totalTabs: set.tabs.length
        }))
      }
    : null;

  const unusedTabs = state.unusedTabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    lastAccessed: tab.lastAccessed
  }));

  return {
    exportedAt: new Date().toISOString(),
    planSource: state.planSource,
    options: getOptions(),
    settings: {
      model: window.TabbitAiConfig.modelsForProvider(state.aiSettings).model,
      briefModel: state.aiSettings?.briefModel || null,
      provider: state.aiSettings?.provider || null,
      hasApiKey: Boolean(state.aiSettings?.apiKey),
      contextLength: (state.aiSettings?.context || "").length,
      context: state.aiSettings?.context || ""
    },
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      windowId: tab.windowId,
      groupId: tab.groupId,
      pinned: tab.pinned,
      active: tab.active,
      index: tab.index
    })),
    groupPlan,
    duplicatePlan,
    unusedTabs,
    sessionCount: state.sessions.length,
    aiDebug: state.aiDebug
  };
}

function downloadJson(payload, filename) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportDebugSnapshot() {
  try {
    const snapshot = buildDebugSnapshot();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadJson(snapshot, `tabbit-debug-${stamp}.json`);

    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setStatus("Exported + copied");
    } catch (_clipboardError) {
      setStatus("Exported");
    }
  } catch (error) {
    setStatus("Export failed", "error");
    console.error(error);
  }
}

async function deleteSession(sessionId) {
  const nextSessions = state.sessions.filter((session) => session.id !== sessionId);
  await setSessions(nextSessions);
  renderSessions();
  setStatus("Deleted");
}

function bindEvents() {
  elements.organizeButton.addEventListener("click", organizeTabs);
  elements.reorganizeButton.addEventListener("click", reorganizeTabs);
  elements.dedupeButton.addEventListener("click", closeDuplicateTabs);
  elements.unusedButton.addEventListener("click", closeUnusedTabs);
  elements.ungroupButton.addEventListener("click", ungroupTabs);
  elements.refreshButton.addEventListener("click", replan);
  elements.saveSessionButton.addEventListener("click", saveSession);
  elements.debugExportButton.addEventListener("click", exportDebugSnapshot);

  elements.aiProvider.addEventListener("change", saveAiSettings);
  elements.aiApiKey.addEventListener("change", saveAiSettings);
  elements.aiModel.addEventListener("change", saveAiSettings);
  elements.aiBriefModel.addEventListener("change", saveAiSettings);
  elements.aiContext.addEventListener("change", saveAiSettings);

  elements.aiToggle.addEventListener("click", () => {
    if (document.body.dataset.hasKey !== "yes") {
      return;
    }
    const expanded = elements.aiSurface.dataset.expanded === "yes";
    setAiExpanded(!expanded);
  });

  elements.sessionList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-session-action]");

    if (!button) {
      return;
    }

    const sessionId = button.dataset.sessionId;

    if (button.dataset.sessionAction === "restore") {
      restoreSession(sessionId);
      return;
    }

    deleteSession(sessionId);
  });
}

async function init() {
  bindEvents();
  await loadAiSettings();
  const hasKey = hasAiAccess(state.aiSettings);
  setKeyState(hasKey);

  const uiState = await getStoredUiState();
  setAiExpanded(hasKey ? Boolean(uiState.aiExpanded) : true, { persist: false });

  state.sessions = await getSessions();
  renderSessions();
  await refresh();
}

init();
