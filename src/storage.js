"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitStorage = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({ chrome, config, keys }) {
    const { normalizeAiSettings, MODEL_ROUTING_VERSION } = config;
    const AI_SETTINGS_KEY = keys.aiSettings;
    async function getStored(key) {
      const result = await chrome.storage.local.get(key);
      return result[key] || null;
    }

    async function getStoredAiSettings() {
      const settings = (await getStored(AI_SETTINGS_KEY)) || {};

      const normalized = normalizeAiSettings(settings);
      if (settings.modelRoutingVersion !== MODEL_ROUTING_VERSION) {
        await chrome.storage.local.set({ [AI_SETTINGS_KEY]: normalized });
      }
      return normalized;
    }

    return { get: getStored, getAiSettings: getStoredAiSettings };
  },
);
