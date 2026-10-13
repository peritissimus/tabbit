// Composition root: adapters, feature workflows, and Chrome event routing only.
importScripts(
  "contracts.js",
  "build-timing.js",
  "ai-config.js",
  "organizer.js",
  "grouping-prompt.js",
  "organization-workflow.js",
  "workspace.js",
  "discovery.js",
  "storage.js",
  "build-lifecycle.js",
  "ai-transport.js",
  "page-reader.js",
  "community-reader.js",
  "publisher-reader.js",
  "brief-workflow.js",
  "feed-workflow.js",
  "grouping-workflow.js",
);
const { keys, messages } = self.TabbitContracts;
const config = self.TabbitAiConfig;
const store = self.createTabbitStorage({ chrome, config, keys });
const ai = self.createTabbitAiTransport({ chrome, fetch, config });
const reader = self.createTabbitPageReader({
  chrome,
  organizer: self.TabbitOrganizer,
  discovery: self.TabbitDiscovery,
});
const publisherReader = self.createTabbitPublisherReader({ fetch });
const communityReader = self.createTabbitCommunityReader({ fetch });
const dependencies = {
  chrome,
  store,
  ai,
  reader,
  config,
  keys,
  messages,
  createLifecycle: self.createTabbitBuildLifecycle,
  timing: self.TabbitBuildTiming,
};
const brief = self.createTabbitBriefWorkflow({
  ...dependencies,
  workspace: self.TabbitWorkspace,
});
const feed = self.createTabbitFeedWorkflow({
  ...dependencies,
  communityReader,
  publisherReader,
  discovery: self.TabbitDiscovery,
});
const grouping = self.createTabbitGroupingWorkflow(dependencies);
const organization = self.createTabbitOrganizationWorkflow({...dependencies, grouping, organizer:self.TabbitOrganizer, prompt:self.TabbitGroupingPrompt});
const TICK_ALARM = "tabbit.tick",
  TICK_MINUTES = 30;

async function tick() {
  if (!(await chrome.alarms.get(TICK_ALARM))) {
    await chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_MINUTES });
  }

  await brief.resume();
  await brief.refresh();
  await feed.tick();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === messages.organizeTabs) {
    const windowId = _sender.tab?.windowId;
    if (!Number.isInteger(windowId)) { sendResponse({error:"Open a new tab in the window you want to organize."}); return; }
    organization.run(windowId, _sender.tab.id).catch(console.error);
    sendResponse({ok:true});
    return;
  }
  if (message?.type === messages.buildFeed) {
    feed.start();
    sendResponse({ ok: true });
    return;
  }
  if (
    message?.type === messages.feedFeedback ||
    message?.type === messages.feedPreferences
  ) {
    feed
      .updatePreference(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === messages.requestPlan) {
    grouping.run(message).then(sendResponse);
    return true;
  }

  if (message?.type === messages.buildBrief) {
    brief.start();
    sendResponse({ ok: true });
  } else if (message?.type === messages.wake) {
    tick();
    sendResponse({ ok: true });
  }
});

chrome.alarms.onAlarm.addListener(tick);
chrome.runtime.onStartup.addListener(tick);
chrome.runtime.onInstalled.addListener(tick);
