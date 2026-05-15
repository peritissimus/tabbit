const {
  TAB_GROUP_ID_NONE,
  buildGroupingPlanFromAiGroups,
  buildGroupingPlan,
  findDuplicateTabs
} = window.TabbitOrganizer;

const STORAGE_KEY = "tabbit.sessions";
const AI_SETTINGS_KEY = "tabbit.aiSettings";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_AI_MODEL = "gpt-5.4-nano";
const TAB_GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

const DEFAULT_OPTIONS = {
  collapseGroups: false,
  currentWindowOnly: true,
  includePinned: false,
  minGroupSize: 2
};

const elements = {
  aiApiKey: document.querySelector("#aiApiKey"),
  aiContext: document.querySelector("#aiContext"),
  aiModel: document.querySelector("#aiModel"),
  debugExportButton: document.querySelector("#debugExportButton"),
  dedupeButton: document.querySelector("#dedupeButton"),
  duplicateCount: document.querySelector("#duplicateCount"),
  groupCount: document.querySelector("#groupCount"),
  groupPreview: document.querySelector("#groupPreview"),
  organizeButton: document.querySelector("#organizeButton"),
  refreshButton: document.querySelector("#refreshButton"),
  saveSessionButton: document.querySelector("#saveSessionButton"),
  sessionCount: document.querySelector("#sessionCount"),
  sessionList: document.querySelector("#sessionList"),
  statusPill: document.querySelector("#statusPill"),
  tabCount: document.querySelector("#tabCount"),
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

function setBusy(isBusy) {
  for (const button of [
    elements.dedupeButton,
    elements.organizeButton,
    elements.refreshButton,
    elements.saveSessionButton,
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

async function getStoredAiSettings() {
  const result = await chrome.storage.local.get(AI_SETTINGS_KEY);
  const settings = result[AI_SETTINGS_KEY] || {};

  return {
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey : "",
    model: typeof settings.model === "string" && settings.model.trim() ? settings.model : DEFAULT_AI_MODEL,
    context: typeof settings.context === "string" ? settings.context : ""
  };
}

function readAiSettingsFromForm() {
  const typedApiKey = elements.aiApiKey.value.trim();
  const storedApiKey = state.aiSettings?.apiKey || "";
  const typedModel = elements.aiModel.value.trim();
  const typedContext = elements.aiContext.value;

  return {
    apiKey: typedApiKey || storedApiKey,
    model: typedModel || DEFAULT_AI_MODEL,
    context: typedContext.trim().slice(0, 600)
  };
}

async function saveAiSettings() {
  const previousHadKey = Boolean(state.aiSettings?.apiKey);
  const nextSettings = readAiSettingsFromForm();
  state.aiSettings = nextSettings;
  await chrome.storage.local.set({ [AI_SETTINGS_KEY]: nextSettings });
  renderAiSettings(nextSettings);

  const hasKey = Boolean(nextSettings.apiKey);
  setKeyState(hasKey);

  if (hasKey && !previousHadKey) {
    await refresh();
  }
}

function renderAiSettings(settings) {
  elements.aiModel.value = settings.model || DEFAULT_AI_MODEL;
  elements.aiContext.value = settings.context || "";
  elements.aiApiKey.value = "";
  elements.aiApiKey.placeholder = settings.apiKey ? "Saved locally" : "sk-...";
}

async function loadAiSettings() {
  state.aiSettings = await getStoredAiSettings();
  renderAiSettings(state.aiSettings);
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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrlForAi(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch (_error) {
    return String(url || "").slice(0, 300);
  }
}

function safeText(value, maxLength) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3).trim()}...` : cleaned;
}

function buildAiMessages(tabs, options, settings) {
  const aiTabs = tabs
    .filter((tab) => window.TabbitOrganizer.isGroupableTab(tab, options))
    .map((tab) => ({
      id: tab.id,
      title: safeText(tab.title || "", 160),
      url: safeUrlForAi(tab.url),
      windowId: tab.windowId
    }));

  const userContext = String(settings?.context || "").trim();

  const systemLines = [
    "You organize Chrome tabs into useful native tab groups.",
    "Return only a valid JSON object.",
    "Use this exact shape: {\"groups\":[{\"title\":\"short name\",\"color\":\"blue\",\"tabIds\":[1,2]}]}.",
    `Allowed colors: ${TAB_GROUP_COLORS.join(", ")}.`,
    "Use only tab IDs from the input. Put each tab ID in at most one group.",
    "Keep titles under 24 characters. One or two words is ideal.",
    "Create as many cohesive groups as you can — prefer many specific groups over a few broad buckets.",
    "Any 2+ tabs sharing a clear theme should form a group; do not force unrelated tabs together.",
    "Do NOT include localhost / 127.0.0.1 / 0.0.0.0 tabs in any group — they are handled separately and must not appear in your output.",
    "Recognize developer patterns: group cloud consoles and monitoring tools (AWS, GCP, Datadog, Grafana, Sentry, CloudWatch) as 'Infra'; group internal company subdomains (any private/non-public domain a user mentions) under that company's name.",
    "Distinguish AI assistants you talk to (ChatGPT, Claude, Gemini, Perplexity) from AI products/dashboards you build with (Retell AI, Vapi, ElevenLabs, OpenAI platform): treat the latter as work tools belonging with the user's company / project group, not as assistants.",
    "Combine AI assistants and general web search into 'AI & Search' only when each has too few tabs to stand alone.",
    "Combine comms tools (Slack, Gmail, Linear, Notion, Discord) into 'Comms' or 'Work' unless one cluster dominates."
  ];

  if (userContext) {
    systemLines.push(`User context (use to inform group titles and patterns): ${userContext}`);
  }

  return [
    { role: "system", content: systemLines.join(" ") },
    {
      role: "user",
      content: JSON.stringify({
        minGroupSize: options.minGroupSize,
        tabs: aiTabs
      })
    }
  ];
}

function parseAiJsonContent(content) {
  const trimmed = String(content || "").trim();

  if (!trimmed) {
    throw new Error("AI returned an empty response");
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("AI did not return JSON");
    }

    return JSON.parse(jsonMatch[0]);
  }
}

async function requestAiGroups(tabs, settings, options) {
  const messages = buildAiMessages(tabs, options, settings);
  const requestBody = {
    max_completion_tokens: 4096,
    messages,
    model: settings.model,
    response_format: { type: "json_object" }
  };

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error) {
    state.aiDebug = {
      timestamp: new Date().toISOString(),
      request: requestBody,
      response: payload,
      status: response.status,
      error: payload.error?.message || `HTTP ${response.status}`
    };
    throw new Error(payload.error?.message || `OpenAI request failed with HTTP ${response.status}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  const parsed = parseAiJsonContent(content);

  state.aiDebug = {
    timestamp: new Date().toISOString(),
    request: requestBody,
    response: payload,
    status: response.status,
    rawContent: content,
    parsed
  };

  if (!Array.isArray(parsed.groups)) {
    throw new Error("AI JSON did not include a groups array");
  }

  return parsed.groups;
}

async function refreshLocal() {
  setBusy(true);

  try {
    state.tabs = await getTabs();
    state.groupPlan = buildGroupingPlan(state.tabs, getOptions());
    state.planSource = "local";
    state.duplicatePlan = findDuplicateTabs(state.tabs, getOptions());
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

  if (!settings.apiKey) {
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
  if (state.aiSettings?.apiKey) {
    await buildAiPlan();
  } else {
    await refreshLocal();
  }
}

async function organizeTabs() {
  if (state.planSource !== "openai") {
    const didBuildAiPlan = await buildAiPlan();

    if (!didBuildAiPlan) {
      return;
    }
  }

  const groups = state.groupPlan?.groups || [];

  if (groups.length === 0) {
    setStatus("No groups", "warn");
    return;
  }

  setBusy(true);

  try {
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

    setStatus("Organized");
    await refresh();
  } catch (error) {
    setStatus("Failed", "error");
    console.error(error);
  } finally {
    setBusy(false);
  }
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

  return {
    exportedAt: new Date().toISOString(),
    planSource: state.planSource,
    options: getOptions(),
    settings: {
      model: state.aiSettings?.model || null,
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
  elements.dedupeButton.addEventListener("click", closeDuplicateTabs);
  elements.ungroupButton.addEventListener("click", ungroupTabs);
  elements.refreshButton.addEventListener("click", refresh);
  elements.saveSessionButton.addEventListener("click", saveSession);
  elements.debugExportButton.addEventListener("click", exportDebugSnapshot);

  elements.aiApiKey.addEventListener("change", saveAiSettings);
  elements.aiModel.addEventListener("change", saveAiSettings);
  elements.aiContext.addEventListener("change", saveAiSettings);

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
  setKeyState(Boolean(state.aiSettings?.apiKey));
  state.sessions = await getSessions();
  renderSessions();
  await refresh();
}

init();
