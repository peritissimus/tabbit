"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitOrganizationView = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({ chrome, document, keys, messages }) {
    const button = document.querySelector("#organizeTabs");
    const status = document.querySelector("#organizationStatus");
    let key, latest, timer;
    function render(value) {
      latest = value;
      const stale =
        value?.status === "running" && Date.now() - value.startedAt > 360000;
      const running = value?.status === "running" && !stale;
      button.disabled = running;
      button.textContent = running ? "Organizing…" : "Organize tabs";
      button.setAttribute("aria-busy", String(running));
      status.textContent = stale
        ? "Organization was interrupted. Try again."
        : value?.message || "";
      status.classList.toggle("is-error", stale || value?.status === "failed");
      clearTimeout(timer);
      if (running)
        timer = setTimeout(
          () => render(latest),
          Math.max(1000, 360001 - (Date.now() - value.startedAt)),
        );
    }
    async function bind() {
      button.disabled = true;
      try {
        const tab = await chrome.tabs.getCurrent();
        key = `${keys.organization}.${tab.windowId}`;
        chrome.storage.onChanged.addListener((changes) => {
          if (changes[key]) render(changes[key].newValue);
        });
        render((await chrome.storage.local.get(key))[key]);
        button.addEventListener("click", async () => {
          render({
            status: "running",
            startedAt: Date.now(),
            message: "Finding a home for your tabs…",
          });
          try {
            const reply = await chrome.runtime.sendMessage({
              type: messages.organizeTabs,
            });
            if (!reply?.ok)
              throw new Error(reply?.error || "Could not start organization");
          } catch (error) {
            render({ status: "failed", message: error.message });
          }
        });
      } catch (error) {
        status.textContent = "Tab organization is unavailable in this page.";
      }
    }
    return { bind };
  },
);
