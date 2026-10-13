"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitOrganizationWorkflow = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({ chrome, store, config, keys, grouping, organizer, prompt }) {
    const pending = new Map();
    async function organize(windowId) {
      const key = `${keys.organization}.${windowId}`;
      const startedAt = Date.now();
      let applied = 0;
      const save = (value) =>
        chrome.storage.local.set({ [key]: { windowId, startedAt, ...value } });
      try {
        await save({
          status: "running",
          message: "Finding a home for your tabs…",
        });
        const settings = await store.getAiSettings();
        const options = { includePinned: false, minGroupSize: 2 };
        const tabs = await chrome.tabs.query({ windowId });
        const ids = new Set(
          tabs
            .filter((t) => organizer.isGroupableTab(t, options))
            .map((t) => t.id),
        );
        let aiGroups;
        if (ids.size && config.hasAiAccess(settings)) {
          const result = await grouping.run({
            requestBody: {
              messages: prompt.buildAiMessages(tabs, options, settings),
            },
            tabIds: [...ids],
            windowId,
          });
          if (result.status !== "done")
            throw new Error(result.error || "Could not organize tabs");
          aiGroups = result.groups;
        }
        // Tabs may have closed, moved windows, or been pinned while AI was working.
        const current = (await chrome.tabs.query({ windowId })).filter(
          (tab) => ids.has(tab.id) && organizer.isGroupableTab(tab, options),
        );
        const plan = aiGroups
          ? organizer.buildGroupingPlanFromAiGroups(current, aiGroups, options)
          : organizer.buildGroupingPlan(current, options);
        for (const group of plan.groups) {
          const groupId = await chrome.tabs.group({
            createProperties: { windowId },
            tabIds: group.tabs.map((tab) => tab.id),
          });
          await chrome.tabGroups.update(groupId, {
            title: group.title,
            color: group.color,
            collapsed: false,
          });
          applied++;
        }
        await save({
          status: "done",
          message: applied
            ? `A little tidier · ${applied} ${applied === 1 ? "group" : "groups"} in this window`
            : "No matching tabs to group in this window",
        });
      } catch (error) {
        await save({
          status: "failed",
          message:
            (applied ? `${applied} groups organized. ` : "") + error.message,
        });
      }
    }
    function run(windowId) {
      if (pending.has(windowId)) return pending.get(windowId);
      const job = Promise.resolve()
        .then(() => organize(windowId))
        .finally(() => pending.delete(windowId));
      pending.set(windowId, job);
      return job;
    }
    return { run };
  },
);
