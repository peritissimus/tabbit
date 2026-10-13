const {
  TAB_GROUP_ID_NONE,
  isGroupableTab,
  isLocalhostTab,
  normalizeUrlForDuplicate
} = window.TabbitOrganizer;

const { DEFAULT_HISTORY_DAYS, buildWorkspace, isAuthenticationUrl, parseInternalDomains } = window.TabbitWorkspace;

const { MAX_SHORTCUTS, readShortcuts, validateShortcuts } = window.TabbitNewtabSettings;
const SHORTCUTS_KEY = "tabbit.shortcuts";

const STORAGE_KEY = "tabbit.sessions";
const AI_SETTINGS_KEY = "tabbit.aiSettings";
const BRIEF_KEY = "tabbit.brief";
const BUILD_KEY = "tabbit.build";
const SNAPSHOT_KEY = "tabbit.newtabSnapshot";
const SNAPSHOT_VERSION = 2;
const { DEFAULT_AI_MODEL, DEFAULT_BRIEF_MODEL, MODEL_ROUTING_VERSION, normalizeAiSettings, buildJsonRequest, hasAiAccess } = window.TabbitAiConfig;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_MAX_RESULTS = 5000;
const CARD_LINK_LIMIT = 6;
const RESULT_LIMIT = 12;
const PROBE_TIMEOUT_MS = 1500;

const elements = {
  board: document.querySelector("#board"),
  brief: document.querySelector("#brief"),
  briefButton: document.querySelector("#briefButton"),
  briefStatus: document.querySelector("#briefStatus"),
  dateLine: document.querySelector("#dateLine"),
  frequent: document.querySelector("#frequent"),
  quickLinks: document.querySelector("#quickLinks"),
  frequentCount: document.querySelector("#frequentCount"),
  greeting: document.querySelector("#greeting"),
  localServers: document.querySelector("#localServers"),
  openGroups: document.querySelector("#openGroups"),
  results: document.querySelector("#results"),
  search: document.querySelector("#search"),
  clearSearch: document.querySelector("#clearSearch"),
  sessionCount: document.querySelector("#sessionCount"),
  sessionList: document.querySelector("#sessionList"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsProvider: document.querySelector("#settingsProvider"),
  settingsApiKey: document.querySelector("#settingsApiKey"),
  settingsCodexNote: document.querySelector("#settingsCodexNote"),
  settingsModel: document.querySelector("#settingsModel"),
  settingsBriefModel: document.querySelector("#settingsBriefModel"),
  settingsContext: document.querySelector("#settingsContext"),
  settingsError: document.querySelector("#settingsError"),
  shortcutDialog: document.querySelector("#shortcutDialog"),
  shortcutRows: document.querySelector("#shortcutRows"),
  shortcutError: document.querySelector("#shortcutError"),
  shortcutSuggestion: document.querySelector("#shortcutSuggestion"),
  otherServers: document.querySelector("#otherServers"),
  otherServerList: document.querySelector("#otherServerList"),
  otherServersSummary: document.querySelector("#otherServersSummary")
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
  shortcuts: readShortcuts(null),
  aiSettings: null,
  brief: null,
  briefExpanded: false,
  build: null,
  groups: [],
  openByUrl: new Map(),
  results: [],
  selectedResult: 0,
  probedOrigins: new Set(),
  serverStatus: new Map(),
  sessions: [],
  tabs: [],
  workspace: { categories: [], localServers: [], pages: [], siteCount: 0 },
  workspaceReady: false
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch (_error) {
    return "";
  }
}

function faviconUrl(url) {
  return `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(url)}&size=32`;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function formatAge(timestamp) {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function timeOfDay(date) {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) {
    return "morning";
  }

  if (hour >= 12 && hour < 17) {
    return "afternoon";
  }

  return hour >= 17 && hour < 21 ? "evening" : "night";
}

async function getStoredAiSettings() {
  const result = await chrome.storage.local.get(AI_SETTINGS_KEY);
  const settings = result[AI_SETTINGS_KEY] || {};

  const normalized = normalizeAiSettings(settings);
  if (settings.modelRoutingVersion !== MODEL_ROUTING_VERSION) {
    await chrome.storage.local.set({ [AI_SETTINGS_KEY]: normalized });
  }
  return normalized;
}

async function getSessions() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
}

function validBrief(brief) {
  return brief && Array.isArray(brief.threads) ? brief : null;
}

async function getStoredBuildState() {
  const result = await chrome.storage.local.get([BRIEF_KEY, BUILD_KEY, SNAPSHOT_KEY]);
  return {
    brief: validBrief(result[BRIEF_KEY]),
    build: result[BUILD_KEY] || null,
    snapshot: result[SNAPSHOT_KEY] || null
  };
}

async function loadTabs() {
  const [tabs, groups] = await Promise.all([chrome.tabs.query({}), chrome.tabGroups.query({})]);
  state.tabs = tabs;
  state.groups = groups;
  state.openByUrl = new Map();

  for (const tab of tabs) {
    const key = normalizeUrlForDuplicate(tab.url);

    if (key && !state.openByUrl.has(key)) {
      state.openByUrl.set(key, tab);
    }
  }
}

// What the Local and Frequent sections actually show. Scores shift on every
// load, so comparing this decides whether a re-render would change anything.
function workspaceSignature(workspace) {
  return JSON.stringify([
    workspace.localServers.map((server) => [server.origin, server.title, server.url]),
    workspace.categories.map((category) => [
      category.title,
      category.sites.map((site) => [site.visits, site.lastVisitTime, site.pages.map((page) => [page.url, page.title])])
    ]),
    workspace.siteCount
  ]);
}

// The last computed dashboard is kept in storage so a new tab paints it at
// once instead of visibly recomputing; fresh data then replaces it quietly.
function applySnapshot(snapshot) {
  if (snapshot?.version !== SNAPSHOT_VERSION || !snapshot?.workspace || !Array.isArray(snapshot.workspace.categories)) {
    return;
  }

  state.workspace = snapshot.workspace;
  state.workspaceReady = true;
  state.serverStatus = new Map(Array.isArray(snapshot.serverStatus) ? snapshot.serverStatus : []);
}

function saveSnapshot() {
  chrome.storage.local
    .set({ [SNAPSHOT_KEY]: { version: SNAPSHOT_VERSION, workspace: state.workspace, serverStatus: [...state.serverStatus] } })
    .catch(() => {});
}

async function loadWorkspace() {
  const historyItems = await chrome.history.search({
    maxResults: HISTORY_MAX_RESULTS,
    startTime: Date.now() - DEFAULT_HISTORY_DAYS * DAY_MS,
    text: ""
  });
  const workspace = buildWorkspace(historyItems, {
    internalDomains: parseInternalDomains(state.aiSettings?.context)
  });
  const changed = !state.workspaceReady || workspaceSignature(workspace) !== workspaceSignature(state.workspace);

  state.workspace = workspace;
  state.workspaceReady = true;
  return changed;
}

function openTabAttributes(tab) {
  return tab ? ` data-tab-id="${tab.id}" data-window-id="${tab.windowId}"` : "";
}

function linkHtml({ title, url, detail, selected }) {
  const openTab = state.openByUrl.get(normalizeUrlForDuplicate(url));

  return `
    <a class="link" href="${escapeHtml(url)}" title="${escapeHtml(title || url)}"${openTabAttributes(openTab)}${selected ? ' data-selected="yes"' : ""}>
      <img class="favicon" src="${escapeHtml(faviconUrl(url))}" alt="" />
      <span class="link-title">${escapeHtml(title || url)}</span>
      ${detail ? `<span class="link-detail">${escapeHtml(detail)}</span>` : ""}
      ${openTab ? '<span class="badge">open</span>' : ""}
    </a>
  `;
}

function cardHtml({ title, color, count, note, links, limit = CARD_LINK_LIMIT }) {
  const hiddenCount = links.length - limit;

  return `
    <article class="card">
      <div class="card-head">
        <div class="title-wrap">
          ${color ? `<span class="color-dot" style="background: ${colorMap[color] || colorMap.grey}"></span>` : ""}
          <h3 class="card-title">${escapeHtml(title)}</h3>
        </div>
        ${count ? `<span class="card-count">${escapeHtml(count)}</span>` : ""}
      </div>
      ${note ? `<p class="card-note">${escapeHtml(note)}</p>` : ""}
      ${links.slice(0, limit).map(linkHtml).join("")}
      ${hiddenCount > 0 ? `<details class="card-overflow"><summary class="card-more"><span class="more-label">Show ${hiddenCount} more</span><span class="less-label">Show less</span></summary>${links.slice(limit).map(linkHtml).join("")}</details>` : ""}
    </article>
  `;
}

function renderHeader() {
  const now = new Date();
  elements.greeting.textContent = `Good ${timeOfDay(now)}`;
  elements.dateLine.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(now);
}

function buildStatusText() {
  const { brief, build } = state;

  if (build?.status === "running") {
    const phases = {
      choosing: "Choosing pages to read",
      history: "Reading history",
      reading: `Reading ${build.pageCount || 0} pages`,
      writing: "Writing brief"
    };
    return `${phases[build.phase] || "Building"}…`;
  }

  if (build?.status === "failed" && build.finishedAt > (brief?.createdAt || 0)) {
    return `Failed: ${build.error || "unknown error"}`;
  }

  return brief ? `Built ${formatAge(brief.createdAt)}` : "";
}

function sourcesText(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return "";
  }

  const failed = sources.filter((source) => !source.ok);
  const read = `Read ${sources.length - failed.length} of ${sources.length} pages`;
  return failed.length ? `${read}. Could not read: ${failed.map((source) => hostOf(source.url)).join(", ")}` : read;
}

function renderBrief() {
  const hasKey = hasAiAccess(state.aiSettings);
  const brief = state.brief;
  const isRunning = state.build?.status === "running";

  elements.briefButton.hidden = !hasKey;
  elements.briefButton.disabled = isRunning;
  elements.briefButton.textContent = brief ? "Rebuild" : "Build";
  elements.briefStatus.textContent = buildStatusText();
  elements.briefStatus.classList.toggle("is-processing", isRunning);
  elements.brief.setAttribute("aria-busy", String(isRunning));

  if (!brief) {
    if (isRunning) {
      elements.brief.innerHTML =
        '<div class="loading-lines" aria-hidden="true"><span></span><span></span><span></span></div><div class="empty">Building your brief. You can close this tab; it keeps going in the background.</div>';
      return;
    }

    elements.brief.innerHTML = hasKey
      ? '<div class="empty">Build a brief to see what needs your attention and the work threads you have in flight.</div>'
      : '<div class="empty">Open Settings to add an OpenAI key or use your Codex subscription, then build an AI brief of your work threads.</div>';
    return;
  }

  const attention = (brief.attention || [])
    .map((entry) => linkHtml({ title: entry.text, url: entry.url, detail: hostOf(entry.url) }))
    .join("");
  const threads = brief.threads
    .map((thread) => cardHtml({ title: thread.title, note: thread.note, links: thread.links }))
    .join("");
  const sources = sourcesText(brief.sources);

  elements.brief.innerHTML = `
    ${(brief.attention || []).length
      ? `<a class="brief-takeaway" href="${escapeHtml(brief.attention[0].url)}"${openTabAttributes(state.openByUrl.get(normalizeUrlForDuplicate(brief.attention[0].url)))}><span class="takeaway-label">Worth a look</span><span>${escapeHtml(brief.attention[0].text)}</span><span aria-hidden="true">↗</span></a>`
      : `<p class="brief-headline">${escapeHtml(brief.headline || "No attention items in your latest brief.")}</p>`}
    <button class="brief-toggle" type="button" aria-expanded="${state.briefExpanded}" aria-controls="briefDetails" data-brief-toggle>
      ${state.briefExpanded ? "Hide details" : `View brief · ${(brief.attention || []).length} attention items · ${brief.threads.length} threads`}
      <span aria-hidden="true">${state.briefExpanded ? "−" : "+"}</span>
    </button>
    <div id="briefDetails"${state.briefExpanded ? "" : " hidden"}>
    ${(brief.attention || []).length && brief.headline ? `<p class="brief-headline">${escapeHtml(brief.headline)}</p>` : ""}
    ${attention ? `<div class="attention"><h3 class="attention-title">Needs attention</h3>${attention}</div>` : ""}
    ${threads ? `<div class="card-grid">${threads}</div>` : '<div class="empty">No clear work threads right now.</div>'}
    ${sources ? `<p class="brief-sources">${escapeHtml(sources)}</p>` : ""}
    </div>
  `;
}

function getLocalServers() {
  const servers = state.workspace.localServers.filter((server) => !isAuthenticationUrl(server.url));
  const openByOrigin = new Map();

  for (const tab of state.tabs) {
    if (!isLocalhostTab(tab) || isAuthenticationUrl(tab.url)) {
      continue;
    }

    const parsed = new URL(tab.url);

    if (openByOrigin.has(parsed.origin)) {
      continue;
    }

    openByOrigin.set(parsed.origin, tab);

    if (!servers.some((server) => server.origin === parsed.origin)) {
      servers.unshift({ origin: parsed.origin, label: parsed.host, title: tab.title, url: tab.url });
    }
  }

  return servers.map((server) => ({ ...server, openTab: openByOrigin.get(server.origin) }));
}

function serverHtml(server) {
  const status = state.serverStatus.get(server.origin) || "unknown";
  const label = status === "up" ? "Running" : status === "down" ? "Offline" : "Not checked";
  return `<a class="server" href="${escapeHtml(server.url)}"${openTabAttributes(server.openTab)} title="${escapeHtml(server.origin)} · ${label}">
    <span class="status-dot" data-status="${status}"></span>
    <span class="server-copy"><span class="server-title">${escapeHtml(server.title || server.label)}</span><span class="server-label">${escapeHtml(server.label)}</span></span>
    <span class="server-state">${label}</span>
  </a>`;
}

function renderLocalServers() {
  const servers = getLocalServers();
  const running = servers.filter((server) => state.serverStatus.get(server.origin) === "up");
  const other = servers.filter((server) => state.serverStatus.get(server.origin) !== "up");
  elements.localServers.innerHTML = running.map(serverHtml).join("") || (state.workspaceReady
    ? '<p class="server-empty">No running servers detected.</p>' : "");
  elements.otherServers.hidden = other.length === 0;
  elements.otherServersSummary.textContent = `Other servers · ${other.length}`;
  elements.otherServerList.innerHTML = other.map(serverHtml).join("");
}

// Each server is checked once per page load. The stored status is shown in
// the meantime, and the list is only redrawn if a status actually changed.
async function probeLocalServers() {
  // Chrome refuses requests to 0.0.0.0, so those stay "unknown" rather than "down".
  const pending = getLocalServers().filter(
    (server) => !state.probedOrigins.has(server.origin) && !server.origin.includes("//0.0.0.0")
  );
  let changed = false;

  await Promise.all(
    pending.map(async (server) => {
      state.probedOrigins.add(server.origin);
      let status = "up";

      try {
        await fetch(server.origin, {
          cache: "no-store",
          mode: "no-cors",
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
        });
      } catch (_error) {
        status = "down";
      }

      changed = changed || state.serverStatus.get(server.origin) !== status;
      state.serverStatus.set(server.origin, status);
    })
  );

  if (changed) {
    renderLocalServers();
    saveSnapshot();
  }
}

function renderOpenGroups() {
  const tabs = state.tabs.filter((tab) => isGroupableTab(tab, { includePinned: true }));
  const toLink = (tab) => ({ title: tab.title, url: tab.url, detail: hostOf(tab.url) });
  const cards = state.groups
    .map((group) => ({
      title: group.title || "Untitled",
      color: group.color,
      links: tabs.filter((tab) => tab.groupId === group.id).map(toLink)
    }))
    .filter((card) => card.links.length > 0);

  const ungrouped = tabs.filter((tab) => tab.groupId === TAB_GROUP_ID_NONE).map(toLink);

  if (ungrouped.length > 0) {
    cards.push({ title: "Ungrouped", links: ungrouped });
  }

  elements.openGroups.innerHTML =
    cards.map((card) => cardHtml({ ...card, count: `${card.links.length} ${card.links.length === 1 ? "tab" : "tabs"}` })).join("") ||
    '<div class="empty">No other tabs open.</div>';
}

function renderQuickLinks() {
  elements.quickLinks.innerHTML = state.shortcuts.map((page) => {
    const openTab = state.openByUrl.get(normalizeUrlForDuplicate(page.url));
    return `<a class="quick-link" href="${escapeHtml(page.url)}"${openTabAttributes(openTab)} title="${escapeHtml(page.url)}">
      <span class="quick-icon"><img class="favicon" src="${escapeHtml(faviconUrl(page.url))}" alt="" /></span>
      <span class="quick-title">${escapeHtml(page.label)}</span>
    </a>`;
  }).join("") || '<p class="subtle-count">Use Edit shortcuts to add your everyday destinations.</p>';
}

function renderFrequent() {
  const { categories, siteCount } = state.workspace;
  elements.frequentCount.textContent = siteCount ? `${siteCount} sites · ${DEFAULT_HISTORY_DAYS} days` : "";

  elements.frequent.innerHTML =
    categories
      .map((category) =>
        cardHtml({
          title: category.title,
          color: category.color,
          limit: category.sites.length,
          links: [
            ...category.sites.map((site) => site.pages[0]),
            ...category.sites.flatMap((site) => site.pages.slice(1))
          ].filter(Boolean)
            .map((page) => ({ title: page.title, url: page.url, detail: page.host }))
        })
      )
      .join("") || (state.workspaceReady ? '<div class="empty">Not enough browsing history yet.</div>' : "");
}

function renderSessions() {
  const count = state.sessions.length;
  elements.sessionCount.textContent = `${count} saved`;

  if (count === 0) {
    elements.sessionList.innerHTML = '<div class="empty">Sessions saved from the Tabbit popup show up here.</div>';
    return;
  }

  elements.sessionList.innerHTML = state.sessions
    .map(
      (session) => `
        <article class="session-row">
          <div class="session-copy">
            <span class="card-title">${escapeHtml(session.name)}</span>
            <span class="session-detail">${session.tabs.length} tabs · ${escapeHtml(formatTime(session.createdAt))}</span>
          </div>
          <button class="session-action" data-session-id="${escapeHtml(session.id)}" type="button">Restore</button>
        </article>
      `
    )
    .join("");
}

function findResults(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const candidates = [
    ...state.tabs.filter((tab) => isGroupableTab(tab, { includePinned: true })),
    ...state.workspace.pages
  ];
  const seen = new Set();
  const results = [];

  for (const candidate of candidates) {
    const key = normalizeUrlForDuplicate(candidate.url);
    const haystack = `${candidate.title || ""} ${candidate.url}`.toLowerCase();

    if (!key || seen.has(key) || !terms.every((term) => haystack.includes(term))) {
      continue;
    }

    seen.add(key);
    results.push({ title: candidate.title, url: candidate.url, detail: hostOf(candidate.url) });

    if (results.length >= RESULT_LIMIT) {
      break;
    }
  }

  return results;
}

function renderResults() {
  const query = elements.search.value.trim();
  const isSearching = query.length > 0;

  elements.clearSearch.hidden = !isSearching;
  elements.results.hidden = !isSearching;
  elements.board.hidden = isSearching;

  if (!isSearching) {
    state.results = [];
    return;
  }

  state.results = findResults(query);
  state.selectedResult = Math.min(state.selectedResult, Math.max(0, state.results.length - 1));

  elements.results.innerHTML =
    state.results
      .map((result, index) => linkHtml({ ...result, selected: index === state.selectedResult }))
      .join("") || '<div class="empty">No matching tab or page. Press Enter to search the web.</div>';
}

function renderAll() {
  renderBrief();
  renderLocalServers();
  renderOpenGroups();
  renderQuickLinks();
  renderFrequent();
  renderSessions();
  renderResults();
}

async function focusTab(tabId, windowId) {
  try {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
    const currentTab = await chrome.tabs.getCurrent();

    if (currentTab && currentTab.id !== tabId) {
      await chrome.tabs.remove(currentTab.id);
    }
  } catch (error) {
    console.error(error);
    await loadTabs();
    renderAll();
  }
}

function openResult(result) {
  const openTab = state.openByUrl.get(normalizeUrlForDuplicate(result.url));

  if (openTab) {
    focusTab(openTab.id, openTab.windowId);
    return;
  }

  window.location.href = result.url;
}

function submitSearch() {
  const query = elements.search.value.trim();
  const result = state.results[state.selectedResult];

  if (result) {
    openResult(result);
    return;
  }

  if (!query) {
    return;
  }

  if (/^[^\s]+\.[^\s]+$/.test(query) || /^localhost(:\d+)?(\/|$)/.test(query)) {
    const scheme = query.startsWith("localhost") ? "http://" : "https://";
    window.location.href = /^[a-z]+:\/\//i.test(query) ? query : scheme + query;
    return;
  }

  chrome.search.query({ disposition: "CURRENT_TAB", text: query });
}

// The build runs in the background worker and reports through storage, so it
// survives this tab closing and shows up in every other new tab.
async function buildBrief() {
  state.build = { status: "running", phase: "history" };
  renderBrief();

  try {
    await chrome.runtime.sendMessage({ type: "tabbit.buildBrief" });
  } catch (error) {
    state.build = { status: "failed", error: "Background worker did not respond", finishedAt: Date.now() };
    renderBrief();
    console.error(error);
  }
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  if (changes[SHORTCUTS_KEY]) {
    state.shortcuts = readShortcuts(changes[SHORTCUTS_KEY].newValue);
    renderQuickLinks();
  }

  if (changes[BRIEF_KEY]) {
    state.brief = validBrief(changes[BRIEF_KEY].newValue);
  }

  if (changes[BUILD_KEY]) {
    state.build = changes[BUILD_KEY].newValue || null;
  }

  if (changes[STORAGE_KEY]) {
    state.sessions = Array.isArray(changes[STORAGE_KEY].newValue) ? changes[STORAGE_KEY].newValue : [];
  }

  if (changes[AI_SETTINGS_KEY]) {
    getStoredAiSettings().then((settings) => {
      state.aiSettings = settings;
      renderBrief();
    });
  }

  renderBrief();
  renderSessions();
}

async function restoreSession(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  const urls = (session?.tabs || []).map((tab) => tab.url).filter(Boolean);

  if (urls.length > 0) {
    await chrome.windows.create({ focused: true, url: urls });
  }
}

let tabRefreshTimer = null;

function scheduleTabRefresh() {
  clearTimeout(tabRefreshTimer);
  tabRefreshTimer = setTimeout(async () => {
    if (document.hidden) {
      return;
    }

    await loadTabs();
    renderAll();
    probeLocalServers();
  }, 400);
}

let shortcutDraft = [];
let savingShortcuts = false;

function captureShortcutDraft() {
  shortcutDraft = [...elements.shortcutRows.querySelectorAll(".shortcut-row")].map((row) => ({
    label: row.querySelector("[data-shortcut-label]").value,
    url: row.querySelector("[data-shortcut-url]").value
  }));
}

function renderShortcutEditor(focusIndex) {
  elements.shortcutRows.innerHTML = shortcutDraft.map((item, index) => `
    <div class="shortcut-row">
      <span class="shortcut-index" aria-hidden="true">${index + 1}</span>
      <label>Name<input data-shortcut-label maxlength="32" value="${escapeHtml(item.label)}" aria-label="Shortcut ${index + 1} name" /></label>
      <label>URL<input data-shortcut-url value="${escapeHtml(item.url)}" placeholder="https://example.com" aria-label="Shortcut ${index + 1} URL" spellcheck="false" /></label>
      <div class="shortcut-actions">
        <button class="icon-button" type="button" data-shortcut-action="up" data-index="${index}" aria-label="Move shortcut ${index + 1} up" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="icon-button" type="button" data-shortcut-action="down" data-index="${index}" aria-label="Move shortcut ${index + 1} down" ${index === shortcutDraft.length - 1 ? "disabled" : ""}>↓</button>
        <button class="icon-button" type="button" data-shortcut-action="remove" data-index="${index}" aria-label="Remove shortcut ${index + 1}">×</button>
      </div>
    </div>`).join("");
  const full = shortcutDraft.length >= MAX_SHORTCUTS;
  document.querySelector("#addShortcut").disabled = full;
  elements.shortcutSuggestion.disabled = full;
  document.querySelector("#shortcutCount").textContent = `${shortcutDraft.length} of ${MAX_SHORTCUTS} shortcuts`;
  if (focusIndex !== undefined) {
    elements.shortcutRows.querySelectorAll("[data-shortcut-label]")[focusIndex]?.focus();
  }
}

function openShortcutEditor() {
  shortcutDraft = state.shortcuts.map((item) => ({ ...item }));
  elements.shortcutError.textContent = "";
  const hosts = new Set(shortcutDraft.map((item) => hostOf(item.url)));
  const sites = state.workspace.categories.flatMap((category) => category.sites)
    .filter((site) => site.host !== "drive.google.com" && !hosts.has(site.host))
    .sort((a, b) => b.visits - a.visits);
  elements.shortcutSuggestion.innerHTML = '<option value="">Choose a site…</option>' + sites.map((site) =>
    `<option value="${escapeHtml(site.pages[0].url)}">${escapeHtml(site.host)}</option>`).join("");
  renderShortcutEditor();
  elements.shortcutDialog.showModal();
}

function closeShortcutEditor() {
  if (!savingShortcuts) elements.shortcutDialog.close();
}

async function saveShortcutEditor(event) {
  event.preventDefault();
  if (savingShortcuts) return;
  captureShortcutDraft();
  elements.shortcutError.textContent = "";
  let shortcuts;
  try {
    shortcuts = validateShortcuts(shortcutDraft);
  } catch (error) {
    elements.shortcutError.textContent = error.message;
    return;
  }
  savingShortcuts = true;
  const form = document.querySelector("#shortcutForm");
  form.inert = true;
  try {
    await chrome.storage.local.set({ [SHORTCUTS_KEY]: shortcuts });
    state.shortcuts = shortcuts;
    renderQuickLinks();
    elements.shortcutDialog.close();
  } catch (_error) {
    elements.shortcutError.textContent = "Could not save shortcuts. Your changes are still here; try again.";
  } finally {
    savingShortcuts = false;
    form.inert = false;
  }
}

let savingSettings = false;

function renderSettingsProvider() {
  const codex = elements.settingsProvider.value === "codex";
  elements.settingsApiKey.closest("label").hidden = codex;
  elements.settingsCodexNote.hidden = !codex;
}

function openSettings() {
  const settings = normalizeAiSettings(state.aiSettings || {});
  elements.settingsProvider.value = settings.provider;
  // The saved key is never shown; leaving the field blank keeps it.
  elements.settingsApiKey.value = "";
  elements.settingsApiKey.placeholder = settings.apiKey ? "Saved locally" : "sk-...";
  elements.settingsModel.value = settings.model;
  elements.settingsBriefModel.value = settings.briefModel;
  elements.settingsContext.value = settings.context;
  elements.settingsError.textContent = "";
  renderSettingsProvider();
  elements.settingsDialog.showModal();
}

function closeSettings() {
  if (!savingSettings) elements.settingsDialog.close();
}

async function saveSettings(event) {
  event.preventDefault();
  if (savingSettings) return;
  elements.settingsError.textContent = "";
  const settings = normalizeAiSettings({
    provider: elements.settingsProvider.value,
    apiKey: elements.settingsApiKey.value.trim() || state.aiSettings?.apiKey || "",
    model: elements.settingsModel.value,
    briefModel: elements.settingsBriefModel.value,
    context: elements.settingsContext.value.trim().slice(0, 600),
    modelRoutingVersion: MODEL_ROUTING_VERSION
  });
  savingSettings = true;
  const form = document.querySelector("#settingsForm");
  form.inert = true;
  try {
    await chrome.storage.local.set({ [AI_SETTINGS_KEY]: settings });
    state.aiSettings = settings;
    renderBrief();
    elements.settingsDialog.close();
  } catch (_error) {
    elements.settingsError.textContent = "Could not save settings. Your changes are still here; try again.";
  } finally {
    savingSettings = false;
    form.inert = false;
  }
}

function bindSettings() {
  document.querySelector("#openSettings").addEventListener("click", openSettings);
  document.querySelector("#closeSettings").addEventListener("click", closeSettings);
  document.querySelector("#cancelSettings").addEventListener("click", closeSettings);
  document.querySelector("#settingsForm").addEventListener("submit", saveSettings);
  elements.settingsProvider.addEventListener("change", renderSettingsProvider);
  elements.settingsDialog.addEventListener("cancel", (event) => {
    if (savingSettings) event.preventDefault();
  });
}

function bindShortcutEditor() {
  document.querySelector("#editShortcuts").addEventListener("click", openShortcutEditor);
  document.querySelector("#closeShortcuts").addEventListener("click", closeShortcutEditor);
  document.querySelector("#cancelShortcuts").addEventListener("click", closeShortcutEditor);
  document.querySelector("#shortcutForm").addEventListener("submit", saveShortcutEditor);
  elements.shortcutDialog.addEventListener("cancel", (event) => {
    if (savingShortcuts) event.preventDefault();
  });
  document.querySelector("#addShortcut").addEventListener("click", () => {
    captureShortcutDraft();
    if (shortcutDraft.length >= MAX_SHORTCUTS) return;
    shortcutDraft.push({ label: "", url: "https://" });
    renderShortcutEditor(shortcutDraft.length - 1);
  });
  elements.shortcutSuggestion.addEventListener("change", () => {
    const option = elements.shortcutSuggestion.selectedOptions[0];
    if (!option.value) return;
    captureShortcutDraft();
    if (shortcutDraft.length < MAX_SHORTCUTS) {
      shortcutDraft.push({ label: option.textContent.slice(0, 32), url: option.value });
      renderShortcutEditor(shortcutDraft.length - 1);
    }
    elements.shortcutSuggestion.value = "";
  });
  elements.shortcutRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-shortcut-action]");
    if (!button) return;
    captureShortcutDraft();
    const index = Number(button.dataset.index);
    const action = button.dataset.shortcutAction;
    let focusIndex = index;
    if (action === "remove") {
      shortcutDraft.splice(index, 1);
      focusIndex = Math.max(0, Math.min(index, shortcutDraft.length - 1));
    } else {
      const next = index + (action === "up" ? -1 : 1);
      if (next < 0 || next >= shortcutDraft.length) return;
      [shortcutDraft[index], shortcutDraft[next]] = [shortcutDraft[next], shortcutDraft[index]];
      focusIndex = next;
    }
    renderShortcutEditor(focusIndex);
    if (!shortcutDraft.length) document.querySelector("#addShortcut").focus();
  });
}

function bindEvents() {
  bindShortcutEditor();
  bindSettings();
  elements.briefButton.addEventListener("click", buildBrief);
  elements.clearSearch.addEventListener("click", () => {
    elements.search.value = "";
    renderResults();
    elements.search.focus();
  });

  elements.search.addEventListener("input", () => {
    state.selectedResult = 0;
    renderResults();
  });

  elements.search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      submitSearch();
      return;
    }

    if (event.key === "Escape") {
      elements.search.value = "";
      renderResults();
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const count = state.results.length;
    state.selectedResult = count ? (state.selectedResult + step + count) % count : 0;
    renderResults();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !document.querySelector("dialog[open]") && !event.target.closest("input, textarea, select, [contenteditable]")) {
      event.preventDefault();
      elements.search.focus();
    }
  });

  document.addEventListener("click", (event) => {
    const briefToggle = event.target.closest("[data-brief-toggle]");
    if (briefToggle) {
      state.briefExpanded = !state.briefExpanded;
      briefToggle.setAttribute("aria-expanded", String(state.briefExpanded));
      document.querySelector("#briefDetails").hidden = !state.briefExpanded;
      briefToggle.innerHTML = `${state.briefExpanded ? "Hide details" : `View brief · ${(state.brief.attention || []).length} attention items · ${state.brief.threads.length} threads`} <span aria-hidden="true">${state.briefExpanded ? "−" : "+"}</span>`;
      return;
    }
    const sessionButton = event.target.closest("[data-session-id]");

    if (sessionButton) {
      restoreSession(sessionButton.dataset.sessionId);
      return;
    }

    const link = event.target.closest("[data-tab-id]");

    // Modified clicks keep their normal meaning (open a copy in a new tab).
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }

    event.preventDefault();
    focusTab(Number(link.dataset.tabId), Number(link.dataset.windowId));
  });

  chrome.tabs.onCreated.addListener(scheduleTabRefresh);
  chrome.tabs.onRemoved.addListener(scheduleTabRefresh);
  chrome.tabs.onUpdated.addListener(scheduleTabRefresh);
  chrome.tabGroups.onUpdated.addListener(scheduleTabRefresh);
  chrome.storage.onChanged.addListener(handleStorageChange);
  document.addEventListener("visibilitychange", scheduleTabRefresh);
}

async function init() {
  renderHeader();
  bindEvents();

  const [aiSettings, sessions, buildState, savedShortcuts] = await Promise.all([
    getStoredAiSettings(),
    getSessions(),
    getStoredBuildState(),
    chrome.storage.local.get(SHORTCUTS_KEY),
    loadTabs()
  ]);

  state.shortcuts = readShortcuts(savedShortcuts[SHORTCUTS_KEY]);
  state.aiSettings = aiSettings;
  state.sessions = sessions;
  state.brief = buildState.brief;
  state.build = buildState.build;
  applySnapshot(buildState.snapshot);

  renderAll();

  if (await loadWorkspace()) {
    renderAll();
  }

  saveSnapshot();
  probeLocalServers();

  // Lets the worker pick up an interrupted build or refresh a stale brief.
  chrome.runtime.sendMessage({ type: "tabbit.wake" }).catch(() => {});
}

init();
