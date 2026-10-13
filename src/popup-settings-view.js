"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitPopupSettings = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({
    state,
    elements,
    chrome,
    config,
    keys,
    setKeyState,
    setAiExpanded,
    replan,
    renderAiSummary,
  }) {
    const {
      normalizeAiSettings,
      MODEL_ROUTING_VERSION,
      DEFAULT_AI_MODEL,
      DEFAULT_BRIEF_MODEL,
      hasAiAccess,
    } = config;
    const AI_SETTINGS_KEY = keys.aiSettings;
    async function getStoredAiSettings() {
      const result = await chrome.storage.local.get(AI_SETTINGS_KEY);
      const settings = result[AI_SETTINGS_KEY] || {};

      const normalized = normalizeAiSettings(settings);
      if (settings.modelRoutingVersion !== MODEL_ROUTING_VERSION) {
        await chrome.storage.local.set({ [AI_SETTINGS_KEY]: normalized });
      }
      return normalized;
    }

    function readAiSettingsFromForm() {
      const typedApiKey = elements.aiApiKey.value.trim();
      const storedApiKey = state.aiSettings?.apiKey || "";
      const typedModel = elements.aiModel.value.trim();
      const typedContext = elements.aiContext.value;

      return config.withProviderModels(
        {
          ...state.aiSettings,
          provider: state.aiSettings.provider,
          apiKey: typedApiKey || storedApiKey,
          modelRoutingVersion: MODEL_ROUTING_VERSION,
          context: typedContext.trim().slice(0, 600),
        },
        typedModel,
        elements.aiBriefModel.value.trim(),
      );
    }

    async function saveAiSettings() {
      const previousHadKey = hasAiAccess(state.aiSettings);
      const nextSettings = readAiSettingsFromForm();
      nextSettings.provider = elements.aiProvider.value;
      state.aiSettings = nextSettings;
      await chrome.storage.local.set({ [AI_SETTINGS_KEY]: nextSettings });
      renderAiSettings(nextSettings);

      const hasKey = hasAiAccess(nextSettings);
      setKeyState(hasKey);

      if (hasKey && !previousHadKey) {
        setAiExpanded(false);
        await replan();
      }
    }

    function renderAiSettings(settings) {
      config.populateModelSelect(
        elements.aiModel,
        settings.provider,
        config.modelsForProvider(settings).model,
      );
      config.populateModelSelect(
        elements.aiBriefModel,
        settings.provider,
        config.modelsForProvider(settings).briefModel,
      );
      elements.aiContext.value = settings.context || "";
      elements.aiProvider.value = settings.provider;
      elements.aiApiKey.closest(".field").hidden =
        settings.provider !== "openai";
      elements.aiCodexNote.hidden = settings.provider === "openai";
      elements.aiCodexNote.textContent = `Uses the signed-in ${settings.provider === "claude" ? "Claude" : "Codex"} CLI. Run npm run install-${settings.provider}-host once. Subscription usage limits apply.`;
      elements.aiApiKey.value = "";
      elements.aiApiKey.placeholder = settings.apiKey
        ? "Saved locally"
        : "sk-...";
      renderAiSummary();
    }

    async function loadAiSettings() {
      state.aiSettings = await getStoredAiSettings();
      renderAiSettings(state.aiSettings);
    }

    return {
      readAiSettingsFromForm,
      saveAiSettings,
      renderAiSettings,
      loadAiSettings,
    };
  },
);
