"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.createTabbitCleanupWorkflow = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({ chrome, organizer, keys }) {
    const pending = new Map();
    let queue = Promise.resolve();
    const storageKey = (windowId) => `tabbit.cleanup.${windowId}`;
    const isNewTab = (tab) =>
      /^chrome:\/\/(newtab|new-tab-page)\/?(?:[?#].*)?$/.test(tab.url || "") ||
      (tab.url || "").split(/[?#]/)[0] ===
        chrome.runtime.getURL("src/newtab.html");
    const protectedTab = (tab) =>
      tab.pinned || tab.active || tab.audible || tab.pendingUrl;
    function candidates(tabs, initiator, days) {
      const result = new Map();
      const add = (tab, reason) => {
        if (!protectedTab(tab) && tab.id !== initiator && !result.has(tab.id))
          result.set(tab.id, {
            id: tab.id,
            title: tab.title || tab.url,
            url: tab.url,
            reason,
          });
      };
      const newTabs = tabs.filter(isNewTab);
      const keep =
        newTabs.find((t) => t.id === initiator) ||
        newTabs.find((t) => t.active) ||
        newTabs[0];
      newTabs
        .filter((t) => t.id !== keep?.id)
        .forEach((t) => add(t, "Extra new tabs"));
      organizer
        .findDuplicateTabs(tabs, { includePinned: true })
        .removableTabs.forEach((t) => add(t, "Duplicate pages"));
      const keepers = new Set(
        organizer
          .findDuplicateTabs(tabs, { includePinned: true })
          .duplicateSets.map((s) => s.keeper.id),
      );
      organizer
        .findUnusedTabs(tabs, { unusedAfterMs: days * 86400000 })
        .filter((t) => organizer.isGroupableTab(t) && !keepers.has(t.id))
        .forEach((t) => add(t, "Unused tabs"));
      return [...result.values()];
    }
    async function get(windowId) {
      return (await chrome.storage.local.get(storageKey(windowId)))[
        storageKey(windowId)
      ];
    }
    async function save(windowId, value) {
      await chrome.storage.local.set({ [storageKey(windowId)]: value });
    }
    async function preview(windowId, initiator, days = 7) {
      if (![1, 7, 14, 30].includes(days))
        throw Error("Choose a supported inactivity threshold.");
      const prior = await get(windowId);
      const value = {
        token: crypto.randomUUID(),
        createdAt: Date.now(),
        days,
        items: candidates(
          await chrome.tabs.query({ windowId }),
          initiator,
          days,
        ),
        lastSessionId: prior?.lastSessionId,
      };
      await save(windowId, value);
      return value;
    }
    async function execute(windowId, initiator, message) {
      const preview = await get(windowId);
      if (
        !preview ||
        preview.token !== message.token ||
        Date.now() - preview.createdAt > 900000
      )
        throw Error("This preview expired. Open Clean up again.");
      if (preview.completed) return preview.completed;
      const selected = new Set(Array.isArray(message.ids) ? message.ids : []);
      const current = candidates(
        await chrome.tabs.query({ windowId }),
        initiator,
        preview.days,
      );
      const eligible = preview.items.filter(
        (item) =>
          selected.has(item.id) &&
          current.some(
            (t) =>
              t.id === item.id &&
              t.url === item.url &&
              t.reason === item.reason,
          ),
      );
      if (!eligible.length)
        throw Error(
          "No selected tabs are still eligible. Refresh the preview.",
        );
      const session = {
        id: crypto.randomUUID(),
        name: `Before cleanup · ${new Date().toLocaleString()}`,
        createdAt: Date.now(),
        tabs: eligible.map((t) => ({ title: t.title, url: t.url })),
        cleanup: true,
      };
      const stored = await chrome.storage.local.get(keys.sessions);
      // Backup must succeed before the first close. It remains even after a crash.
      await chrome.storage.local.set({
        [keys.sessions]: [session, ...(stored[keys.sessions] || [])],
      });
      preview.lastSessionId = session.id;
      await save(windowId, preview);
      let closed = 0;
      const errors = [],
        closedItems = [];
      for (const item of eligible) {
        const live = await chrome.tabs.get(item.id).catch(() => null);
        if (
          !live ||
          live.windowId !== windowId ||
          protectedTab(live) ||
          live.url !== item.url
        )
          continue;
        const stillEligible = candidates(
          await chrome.tabs.query({ windowId }),
          initiator,
          preview.days,
        ).some(
          (tab) =>
            tab.id === item.id &&
            tab.url === item.url &&
            tab.reason === item.reason,
        );
        if (!stillEligible) continue;
        try {
          await chrome.tabs.remove(item.id);
          closed++;
          closedItems.push(item);
        } catch (error) {
          errors.push(error.message);
        }
      }
      // On a completed run, restore only tabs actually closed (not protected skips).
      const latestSessions =
        (await chrome.storage.local.get(keys.sessions))[keys.sessions] || [];
      await chrome.storage.local.set({
        [keys.sessions]: latestSessions.map((s) =>
          s.id === session.id
            ? {
                ...s,
                tabs: closedItems.map((t) => ({ title: t.title, url: t.url })),
              }
            : s,
        ),
      });
      const completed = {
        closed,
        skipped: selected.size - closed,
        sessionId: session.id,
        error: errors[0] || null,
      };
      await save(windowId, { ...preview, lastSessionId: closed ? session.id : null, completed });
      return completed;
    }
    async function restore(windowId) {
      const state = await get(windowId);
      const sessions =
        (await chrome.storage.local.get(keys.sessions))[keys.sessions] || [];
      const session = sessions.find((s) => s.id === state?.lastSessionId);
      if (!session?.tabs.length) throw Error("No cleanup session to restore.");
      // Saved sessions remain available for later recovery from the dashboard.
      await chrome.windows.create({
        focused: true,
        url: session.tabs.map((t) => t.url),
      });
      await save(windowId, { ...state, lastSessionId: null });
      return { restored: session.tabs.length };
    }
    function run(windowId, initiator, message) {
      if (pending.has(windowId))
        return Promise.reject(Error("Cleanup is already running."));
      const job = queue.catch(() => {})
        .then(() =>
          message.action === "preview"
            ? preview(windowId, initiator, message.days)
            : message.action === "close"
              ? execute(windowId, initiator, message)
              : message.action === "restore"
                ? restore(windowId)
                : get(windowId),
        )
        .finally(() => pending.delete(windowId));
      queue = job;
      pending.set(windowId, job);
      return job;
    }
    return { run, candidates };
  },
);
