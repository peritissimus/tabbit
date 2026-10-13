"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitGroupingWorkflow = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({ chrome, store, ai, config, keys }) {
    const { buildJsonRequest } = config;
    const getStoredAiSettings = store.getAiSettings;
    const PLAN_KEY = keys.plan,
      KEEPALIVE_MS = 20000;
    async function runPlan({ requestBody, tabIds, windowId }) {
      const settings = await getStoredAiSettings();
      requestBody = buildJsonRequest(
        requestBody.messages,
        settings,
        "grouping",
      );
      const plan = {
        status: "running",
        startedAt: Date.now(),
        tabIds,
        windowId,
      };
      const debug = {
        timestamp: new Date().toISOString(),
        provider: settings.provider,
        request: requestBody,
      };
      await chrome.storage.local.set({ [PLAN_KEY]: plan });

      const keepalive = setInterval(
        () => chrome.runtime.getPlatformInfo(),
        KEEPALIVE_MS,
      );
      let result;

      try {
        debug.parsed = await ai.requestGrouping(
          requestBody.messages,
          settings,
          debug,
        );

        if (!Array.isArray(debug.parsed.groups)) {
          throw new Error("AI JSON did not include a groups array");
        }

        result = {
          ...plan,
          status: "done",
          groups: debug.parsed.groups,
          createdAt: Date.now(),
          debug,
        };
      } catch (error) {
        debug.error = error.message;
        result = {
          ...plan,
          status: "failed",
          error: error.message,
          createdAt: Date.now(),
          debug,
        };
      } finally {
        clearInterval(keepalive);
      }

      await chrome.storage.local.set({ [PLAN_KEY]: result });
      return result;
    }

    return { run: runPlan };
  },
);
