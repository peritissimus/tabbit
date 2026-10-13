"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitSearchView = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({
    state,
    elements,
    chrome,
    window,
    isGroupableTab,
    normalizeUrlForDuplicate,
    hostOf,
    linkHtml,
    focusTab,
  }) {
    const RESULT_LIMIT = 12;
    function findResults(query) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const candidates = [
        ...state.tabs.filter((tab) =>
          isGroupableTab(tab, { includePinned: true }),
        ),
        ...state.workspace.pages,
      ];
      const seen = new Set();
      const results = [];

      for (const candidate of candidates) {
        const key = normalizeUrlForDuplicate(candidate.url);
        const haystack =
          `${candidate.title || ""} ${candidate.url}`.toLowerCase();

        if (
          !key ||
          seen.has(key) ||
          !terms.every((term) => haystack.includes(term))
        ) {
          continue;
        }

        seen.add(key);
        results.push({
          title: candidate.title,
          url: candidate.url,
          detail: hostOf(candidate.url),
        });

        if (results.length >= RESULT_LIMIT) {
          break;
        }
      }

      return results;
    }

    function renderResults() {
      const query = elements.search.value.trim();
      const isSearching = query.length > 0;

      elements.clearSearch.hidden = !isSearching;
      elements.results.hidden = !isSearching;
      elements.board.hidden = isSearching;

      if (!isSearching) {
        state.results = [];
        return;
      }

      state.results = findResults(query);
      state.selectedResult = Math.min(
        state.selectedResult,
        Math.max(0, state.results.length - 1),
      );

      elements.results.innerHTML =
        state.results
          .map((result, index) =>
            linkHtml({ ...result, selected: index === state.selectedResult }),
          )
          .join("") ||
        '<div class="empty">No matching tab or page. Press Enter to search the web.</div>';
    }

    function openResult(result) {
      const openTab = state.openByUrl.get(normalizeUrlForDuplicate(result.url));

      if (openTab) {
        focusTab(openTab.id, openTab.windowId);
        return;
      }

      window.location.href = result.url;
    }

    function submitSearch() {
      const query = elements.search.value.trim();
      const result = state.results[state.selectedResult];

      if (result) {
        openResult(result);
        return;
      }

      if (!query) {
        return;
      }

      if (
        /^[^\s]+\.[^\s]+$/.test(query) ||
        /^localhost(:\d+)?(\/|$)/.test(query)
      ) {
        const scheme = query.startsWith("localhost") ? "http://" : "https://";
        window.location.href = /^[a-z]+:\/\//i.test(query)
          ? query
          : scheme + query;
        return;
      }

      chrome.search.query({ disposition: "CURRENT_TAB", text: query });
    }

    return { renderResults, submitSearch };
  },
);
