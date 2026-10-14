"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.createTabbitCleanupWorkflow = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({ chrome, organizer, keys, store, config, ai, cleanupAI }) {
    const pending = new Map();
    let queue = Promise.resolve();
    const storageKey = (windowId) => `tabbit.cleanup.${windowId}`;
    const isNewTab = (tab) =>
      /^chrome:\/\/(newtab|new-tab-page)\/?(?:[?#].*)?$/.test(tab.url || "") ||
      (tab.url || "").split(/[?#]/)[0] ===
        chrome.runtime.getURL("src/newtab.html");
    const protectedTab = (tab) =>
      tab.pinned || tab.active || tab.audible || tab.pendingUrl;
    function candidates(tabs, initiator) {
      const result = new Map();
      const add = (tab, reason) => {
        if (!protectedTab(tab) && tab.id !== initiator && !result.has(tab.id))
          result.set(tab.id, {
            id: tab.id,
            title: tab.title || tab.url,
            url: tab.url,
            reason,
            explanation:
              reason === "Extra new tabs"
                ? "Another new-tab page is kept in this window."
                : "The same URL is open in another tab; keeping the active or most recently used copy.",
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
      // Exact URLs only: different PR diffs, query states and comment fragments matter.
      const buckets = new Map();
      for (const tab of tabs.filter((t) =>
        organizer.isGroupableTab(t, { includePinned: true }),
      )) {
        if (!buckets.has(tab.url)) buckets.set(tab.url, []);
        buckets.get(tab.url).push(tab);
      }
      for (const group of buckets.values()) {
        group.sort(
          (a, b) =>
            Number(Boolean(b.active)) - Number(Boolean(a.active)) ||
            Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
            (b.lastAccessed || 0) - (a.lastAccessed || 0),
        );
        group.slice(1).forEach((tab) => add(tab, "Duplicate pages"));
      }
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
    async function preview(windowId, initiator) {
      const prior = await get(windowId);
      const tabs = await chrome.tabs.query({ windowId });
      const value = {
        token: crypto.randomUUID(),
        createdAt: Date.now(),
        status: "running",
        items: candidates(tabs, initiator),
        lastSessionId: prior?.lastSessionId,
      };
      await save(windowId, value);
      const keepalive = setInterval(
        () => chrome.runtime.getPlatformInfo?.(),
        20000,
      );
      try {
        const settings = store ? await store.getAiSettings() : {};
        if (config?.hasAiAccess(settings) && cleanupAI && ai) {
          const result = await cleanupAI.suggest({
            tabs,
            settings,
            ai,
            organizer,
          });
          const duplicateIds = new Set(value.items.map((t) => t.id));
          // Never close a replacement, even if it was independently a duplicate.
          const retained = new Set(result.items.map((t) => t.replacement.id));
          value.items = value.items.filter((t) => !retained.has(t.id));
          value.items.push(
            ...result.items.filter(
              (t) => !duplicateIds.has(t.id) && t.id !== initiator,
            ),
          );
          value.warning = result.warning;
          value.reviewCount = result.reviewCount;
        } else
          value.warning =
            "Configure an AI provider in Settings for AI cleanup. Showing only extra new tabs and exact duplicates.";
        value.status = "ready";
        value.createdAt = Date.now();
        await save(windowId, value);
        return value;
      } finally {
        clearInterval(keepalive);
      }
    }
    function eligibleItem(item, tabs, initiator, selected) {
      const live = tabs.find((t) => t.id === item.id);
      if (
        !live ||
        protectedTab(live) ||
        live.id === initiator ||
        live.url !== item.url
      )
        return false;
      if (item.reason !== "AI suggestions")
        return candidates(tabs, initiator).some(
          (t) => t.id === item.id && t.reason === item.reason,
        );
      if (
        cleanupAI.isReview(live) ||
        organizer.isLocalhostTab(live) ||
        live.title !== item.title ||
        live.lastAccessed !== item.lastAccessed
      )
        return false;
      return (
        !selected.has(item.replacement.id) &&
        tabs.some(
          (t) =>
            t.id === item.replacement.id &&
            t.url === item.replacement.url &&
            !t.pendingUrl,
        )
      );
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
      const current = await chrome.tabs.query({ windowId });
      const eligible = preview.items.filter(
        (item) =>
          selected.has(item.id) &&
          eligibleItem(item, current, initiator, selected),
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
        const stillEligible = eligibleItem(
          item,
          await chrome.tabs.query({ windowId }),
          initiator,
          selected,
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
      await save(windowId, {
        ...preview,
        lastSessionId: closed ? session.id : null,
        completed,
      });
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
        return message.action === "load"
          ? pending.get(windowId).then(() => get(windowId))
          : Promise.reject(Error("Cleanup is already running."));
      const job = queue
        .catch(() => {})
        .then(() =>
          message.action === "load"
            ? get(windowId).then((saved) =>
                saved?.status === "ready" &&
                Date.now() - saved.createdAt < 900000
                  ? { ...saved, items: saved.completed ? [] : saved.items }
                  : preview(windowId, initiator),
              )
            : message.action === "preview"
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
