"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitServersView = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({
    state,
    elements,
    fetch,
    isAuthenticationUrl,
    isLocalhostTab,
    escapeHtml,
    openTabAttributes,
    saveSnapshot,
  }) {
    const PROBE_TIMEOUT_MS = 1500;
    function getLocalServers() {
      const servers = state.workspace.localServers.filter(
        (server) => !isAuthenticationUrl(server.url),
      );
      const openByOrigin = new Map();

      for (const tab of state.tabs) {
        if (!isLocalhostTab(tab) || isAuthenticationUrl(tab.url)) {
          continue;
        }

        const parsed = new URL(tab.url);

        if (openByOrigin.has(parsed.origin)) {
          continue;
        }

        openByOrigin.set(parsed.origin, tab);

        if (!servers.some((server) => server.origin === parsed.origin)) {
          servers.unshift({
            origin: parsed.origin,
            label: parsed.host,
            title: tab.title,
            url: tab.url,
          });
        }
      }

      return servers.map((server) => ({
        ...server,
        openTab: openByOrigin.get(server.origin),
      }));
    }

    function serverHtml(server) {
      const status = state.serverStatus.get(server.origin) || "unknown";
      const label =
        status === "up"
          ? "Running"
          : status === "down"
            ? "Offline"
            : "Not checked";
      return `<a class="server" href="${escapeHtml(server.url)}"${openTabAttributes(server.openTab)} title="${escapeHtml(server.origin)} · ${label}">
    <span class="status-dot" data-status="${status}"></span>
    <span class="server-copy"><span class="server-title">${escapeHtml(server.title || server.label)}</span><span class="server-label">${escapeHtml(server.label)}</span></span>
    <span class="server-state">${label}</span>
  </a>`;
    }

    function renderLocalServers() {
      const servers = getLocalServers();
      const running = servers.filter(
        (server) => state.serverStatus.get(server.origin) === "up",
      );
      const other = servers.filter(
        (server) => state.serverStatus.get(server.origin) !== "up",
      );
      elements.localServers.innerHTML =
        running.map(serverHtml).join("") ||
        (state.workspaceReady
          ? '<p class="server-empty">No running servers detected.</p>'
          : "");
      elements.otherServers.hidden = other.length === 0;
      elements.otherServersSummary.textContent = `Other servers · ${other.length}`;
      elements.otherServerList.innerHTML = other.map(serverHtml).join("");
    }

    // Each server is checked once per page load. The stored status is shown in
    // the meantime, and the list is only redrawn if a status actually changed.
    async function probeLocalServers() {
      // Chrome refuses requests to 0.0.0.0, so those stay "unknown" rather than "down".
      const pending = getLocalServers().filter(
        (server) =>
          !state.probedOrigins.has(server.origin) &&
          !server.origin.includes("//0.0.0.0"),
      );
      let changed = false;

      await Promise.all(
        pending.map(async (server) => {
          state.probedOrigins.add(server.origin);
          let status = "up";

          try {
            await fetch(server.origin, {
              cache: "no-store",
              mode: "no-cors",
              signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            });
          } catch (_error) {
            status = "down";
          }

          changed = changed || state.serverStatus.get(server.origin) !== status;
          state.serverStatus.set(server.origin, status);
        }),
      );

      if (changed) {
        renderLocalServers();
        saveSnapshot();
      }
    }

    return { renderLocalServers, probeLocalServers };
  },
);
