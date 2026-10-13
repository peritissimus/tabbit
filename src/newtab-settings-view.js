"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitSettingsView = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({ state, elements, chrome, document, config, keys, renderBrief }) {
    const { normalizeAiSettings, MODEL_ROUTING_VERSION } = config;
    const AI_SETTINGS_KEY = keys.aiSettings;
    let savingSettings = false;
    let draft = normalizeAiSettings();
    function captureModels() {
      draft = config.withProviderModels(
        draft,
        elements.settingsModel.value,
        elements.settingsBriefModel.value,
      );
    }
    function changeProvider() {
      captureModels();
      draft.provider = elements.settingsProvider.value;
      const pair = config.modelsForProvider(draft);
      config.populateModelSelect(
        elements.settingsModel,
        draft.provider,
        pair.model,
      );
      config.populateModelSelect(
        elements.settingsBriefModel,
        draft.provider,
        pair.briefModel,
      );
      renderSettingsProvider();
    }

    function renderSettingsProvider() {
      const provider = elements.settingsProvider.value;
      const codex = provider !== "openai";
      elements.settingsCodexNote.textContent = `Uses the signed-in ${provider === "claude" ? "Claude" : "Codex"} CLI. Run npm run install-${provider}-host once. Subscription usage limits apply.`;
      elements.settingsApiKey.closest("label").hidden = codex;
      elements.settingsCodexNote.hidden = !codex;
    }

    function openSettings() {
      const settings = normalizeAiSettings(state.aiSettings || {});
      draft = settings;
      elements.settingsProvider.value = settings.provider;
      // The saved key is never shown; leaving the field blank keeps it.
      elements.settingsApiKey.value = "";
      elements.settingsApiKey.placeholder = settings.apiKey
        ? "Saved locally"
        : "sk-...";
      config.populateModelSelect(
        elements.settingsModel,
        settings.provider,
        config.modelsForProvider(settings).model,
      );
      config.populateModelSelect(
        elements.settingsBriefModel,
        settings.provider,
        config.modelsForProvider(settings).briefModel,
      );
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
      captureModels();
      const settings = normalizeAiSettings({
        ...draft,
        provider: elements.settingsProvider.value,
        apiKey:
          elements.settingsApiKey.value.trim() ||
          state.aiSettings?.apiKey ||
          "",
        context: elements.settingsContext.value.trim().slice(0, 600),
        modelRoutingVersion: MODEL_ROUTING_VERSION,
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
        elements.settingsError.textContent =
          "Could not save settings. Your changes are still here; try again.";
      } finally {
        savingSettings = false;
        form.inert = false;
      }
    }

    function bindSettings() {
      document
        .querySelector("#openSettings")
        .addEventListener("click", openSettings);
      document
        .querySelector("#closeSettings")
        .addEventListener("click", closeSettings);
      document
        .querySelector("#cancelSettings")
        .addEventListener("click", closeSettings);
      document
        .querySelector("#settingsForm")
        .addEventListener("submit", saveSettings);
      elements.settingsProvider.addEventListener("change", changeProvider);
      elements.settingsDialog.addEventListener("cancel", (event) => {
        if (savingSettings) event.preventDefault();
      });
    }

    return { bindSettings };
  },
);
