"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const dialog = $("cleanupDialog"),
    list = $("cleanupList"),
    status = $("cleanupStatus"),
    confirm = $("cleanupConfirm"),
    restore = $("cleanupRestore");
  let preview = null,
    busy = false;
  const selected = () =>
    [...list.querySelectorAll("input[data-tab-id]:checked")].map((input) =>
      Number(input.dataset.tabId),
    );
  function update() {
    const count = selected().length;
    confirm.textContent = `Close ${count} selected ${count === 1 ? "tab" : "tabs"}`;
    confirm.disabled = busy || !count;
  }
  function lock(value) {
    busy = value;
    for (const element of dialog.querySelectorAll("button,input,select"))
      element.disabled = value || element.dataset.empty === "true";
    update();
    dialog.setAttribute("aria-busy", String(value));
  }
  async function send(action, extra = {}) {
    const reply = await chrome.runtime.sendMessage({
      type: "tabbit.cleanup",
      action,
      ...extra,
    });
    if (!reply?.ok)
      throw Error(
        reply?.error ||
          "Reload Tabbit at chrome://extensions, then open a fresh new tab.",
      );
    return reply.result;
  }
  function render() {
    list.replaceChildren();
    for (const reason of ["Extra new tabs", "Duplicate pages", "Unused tabs"]) {
      const items = preview.items.filter((item) => item.reason === reason);
      const section = document.createElement("fieldset"),
        legend = document.createElement("legend");
      const label = document.createElement("label"),
        toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = reason !== "Unused tabs" && items.length > 0;
      toggle.disabled = !items.length;
      toggle.dataset.empty = String(!items.length);
      label.append(
        toggle,
        document.createTextNode(`${reason} · ${items.length}`),
      );
      legend.append(label);
      section.append(legend);
      for (const item of items) {
        const row = document.createElement("label");
        row.className = "cleanup-row";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.dataset.tabId = String(item.id);
        check.checked = toggle.checked;
        const copy = document.createElement("span"),
          title = document.createElement("strong"),
          url = document.createElement("small");
        title.textContent = item.title;
        url.textContent = item.url;
        copy.append(title, url);
        row.append(check, copy);
        section.append(row);
        check.addEventListener("change", () => {
          const inputs = [...section.querySelectorAll("[data-tab-id]")];
          const count = inputs.filter((i) => i.checked).length;
          toggle.checked = count === inputs.length;
          toggle.indeterminate = count > 0 && count < inputs.length;
          update();
        });
      }
      toggle.addEventListener("change", () => {
        for (const input of section.querySelectorAll("[data-tab-id]"))
          input.checked = toggle.checked;
        update();
      });
      list.append(section);
    }
    update();
  }
  async function refresh() {
    lock(true);
    status.textContent = "Checking this window…";
    try {
      preview = await send("preview", { days: Number($("cleanupDays").value) });
      render();
      restore.hidden = !preview.lastSessionId;
      status.textContent = preview.items.length
        ? "Choose what to close. Unused tabs are off by default."
        : "Nothing to clean up in this window.";
    } catch (error) {
      preview = null;
      list.replaceChildren();
      status.textContent = error.message;
    } finally {
      lock(false);
    }
  }
  $("cleanupTabs").addEventListener("click", () => {
    dialog.showModal();
    refresh();
  });
  $("cleanupDismiss").addEventListener("click", () => dialog.close());
  $("cleanupRefresh").addEventListener("click", refresh);
  $("cleanupDays").addEventListener("change", refresh);
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  confirm.addEventListener("click", async () => {
    const ids = selected();
    if (!preview || busy || !ids.length) return;
    lock(true);
    status.textContent = "Saving a recovery session and closing selected tabs…";
    try {
      const result = await send("close", { token: preview.token, ids });
      list.replaceChildren();
      restore.hidden = result.closed === 0;
      status.textContent = `Closed ${result.closed} tabs. ${result.skipped ? `${result.skipped} changed or protected tabs skipped. ` : ""}Recovery is saved in Saved sessions.${result.error ? " " + result.error : ""}`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      lock(false);
    }
  });
  restore.addEventListener("click", async () => {
    lock(true);
    try {
      const result = await send("restore");
      restore.hidden = true;
      status.textContent = `Restored ${result.restored} tabs in a new window.`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      lock(false);
    }
  });
})();
