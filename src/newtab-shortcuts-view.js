"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitShortcutsView = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({
    state,
    elements,
    chrome,
    document,
    shortcuts,
    keys,
    escapeHtml,
    hostOf,
    renderQuickLinks,
  }) {
    const { MAX_SHORTCUTS, validateShortcuts } = shortcuts;
    const SHORTCUTS_KEY = keys.shortcuts;
    let shortcutDraft = [];
    let savingShortcuts = false;

    function captureShortcutDraft() {
      shortcutDraft = [
        ...elements.shortcutRows.querySelectorAll(".shortcut-row"),
      ].map((row) => ({
        label: row.querySelector("[data-shortcut-label]").value,
        url: row.querySelector("[data-shortcut-url]").value,
      }));
    }

    function renderShortcutEditor(focusIndex) {
      elements.shortcutRows.innerHTML = shortcutDraft
        .map(
          (item, index) => `
    <div class="shortcut-row">
      <span class="shortcut-index" aria-hidden="true">${index + 1}</span>
      <label>Name<input data-shortcut-label maxlength="32" value="${escapeHtml(item.label)}" aria-label="Shortcut ${index + 1} name" /></label>
      <label>URL<input data-shortcut-url value="${escapeHtml(item.url)}" placeholder="https://example.com" aria-label="Shortcut ${index + 1} URL" spellcheck="false" /></label>
      <div class="shortcut-actions">
        <button class="icon-button" type="button" data-shortcut-action="up" data-index="${index}" aria-label="Move shortcut ${index + 1} up" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="icon-button" type="button" data-shortcut-action="down" data-index="${index}" aria-label="Move shortcut ${index + 1} down" ${index === shortcutDraft.length - 1 ? "disabled" : ""}>↓</button>
        <button class="icon-button" type="button" data-shortcut-action="remove" data-index="${index}" aria-label="Remove shortcut ${index + 1}">×</button>
      </div>
    </div>`,
        )
        .join("");
      const full = shortcutDraft.length >= MAX_SHORTCUTS;
      document.querySelector("#addShortcut").disabled = full;
      elements.shortcutSuggestion.disabled = full;
      document.querySelector("#shortcutCount").textContent =
        `${shortcutDraft.length} of ${MAX_SHORTCUTS} shortcuts`;
      if (focusIndex !== undefined) {
        elements.shortcutRows
          .querySelectorAll("[data-shortcut-label]")
          [focusIndex]?.focus();
      }
    }

    function openShortcutEditor() {
      shortcutDraft = state.shortcuts.map((item) => ({ ...item }));
      elements.shortcutError.textContent = "";
      const hosts = new Set(shortcutDraft.map((item) => hostOf(item.url)));
      const sites = state.workspace.categories
        .flatMap((category) => category.sites)
        .filter(
          (site) => site.host !== "drive.google.com" && !hosts.has(site.host),
        )
        .sort((a, b) => b.visits - a.visits);
      elements.shortcutSuggestion.innerHTML =
        '<option value="">Choose a site…</option>' +
        sites
          .map(
            (site) =>
              `<option value="${escapeHtml(site.pages[0].url)}">${escapeHtml(site.host)}</option>`,
          )
          .join("");
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
        elements.shortcutError.textContent =
          "Could not save shortcuts. Your changes are still here; try again.";
      } finally {
        savingShortcuts = false;
        form.inert = false;
      }
    }

    function bindShortcutEditor() {
      document
        .querySelector("#editShortcuts")
        .addEventListener("click", openShortcutEditor);
      document
        .querySelector("#closeShortcuts")
        .addEventListener("click", closeShortcutEditor);
      document
        .querySelector("#cancelShortcuts")
        .addEventListener("click", closeShortcutEditor);
      document
        .querySelector("#shortcutForm")
        .addEventListener("submit", saveShortcutEditor);
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
          shortcutDraft.push({
            label: option.textContent.slice(0, 32),
            url: option.value,
          });
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
          [shortcutDraft[index], shortcutDraft[next]] = [
            shortcutDraft[next],
            shortcutDraft[index],
          ];
          focusIndex = next;
        }
        renderShortcutEditor(focusIndex);
        if (!shortcutDraft.length)
          document.querySelector("#addShortcut").focus();
      });
    }

    return { bindShortcutEditor };
  },
);
