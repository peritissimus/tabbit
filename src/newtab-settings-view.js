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
      elements.settingsApiKey.placeholder = settings.apiKey
        ? "Saved locally"
        : "sk-...";
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
        apiKey:
          elements.settingsApiKey.value.trim() ||
          state.aiSettings?.apiKey ||
          "",
        model: elements.settingsModel.value,
        briefModel: elements.settingsBriefModel.value,
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
      elements.settingsProvider.addEventListener(
        "change",
        renderSettingsProvider,
      );
      elements.settingsDialog.addEventListener("cancel", (event) => {
        if (savingSettings) event.preventDefault();
      });
    }

    return { bindSettings };
  },
);
