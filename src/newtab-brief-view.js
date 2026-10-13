"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitBriefView = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({
    state,
    elements,
    chrome,
    document,
    timing,
    config,
    messages,
    formatAge,
    hostOf,
    linkHtml,
    cardHtml,
    escapeHtml,
    openTabAttributes,
    normalizeUrlForDuplicate,
  }) {
    const { hasAiAccess } = config;
    function buildStatusText() {
      const { brief, build } = state;

      if (build?.status === "running") {
        const phases = {
          choosing: "Choosing pages to read",
          history: "Reading history",
          reading: `Reading ${build.pageCount || 0} pages`,
          writing: "Writing brief",
        };
        return `${phases[build.phase] || "Building"}…`;
      }

      if (
        build?.status === "failed" &&
        build.finishedAt > (brief?.createdAt || 0)
      ) {
        return `Failed: ${build.error || "unknown error"}`;
      }

      return brief ? `Built ${formatAge(brief.createdAt)}` : "";
    }

    function sourcesText(sources) {
      if (!Array.isArray(sources) || sources.length === 0) {
        return "";
      }

      const failed = sources.filter((source) => !source.ok);
      const read = `Read ${sources.length - failed.length} of ${sources.length} pages`;
      return failed.length
        ? `${read}. Could not read: ${failed.map((source) => hostOf(source.url)).join(", ")}`
        : read;
    }

    function renderBrief() {
      const hasKey = hasAiAccess(state.aiSettings);
      const brief = state.brief;
      const isRunning = state.build?.status === "running";

      elements.briefButton.hidden = !hasKey;
      elements.briefButton.disabled = isRunning;
      elements.briefButton.textContent = brief ? "Rebuild" : "Build";
      timing.render(document.getElementById("briefTiming"), state.build);
      elements.briefStatus.textContent = buildStatusText();
      elements.briefStatus.classList.toggle("is-processing", isRunning);
      elements.brief.setAttribute("aria-busy", String(isRunning));

      if (!brief) {
        if (isRunning) {
          elements.brief.innerHTML =
            '<div class="loading-lines" aria-hidden="true"><span></span><span></span><span></span></div><div class="empty">Building your brief. You can close this tab; it keeps going in the background.</div>';
          return;
        }

        elements.brief.innerHTML = hasKey
          ? '<div class="empty">Build a brief to see what needs your attention and the work threads you have in flight.</div>'
          : '<div class="empty">Open Settings to add an OpenAI key or use your Codex subscription, then build an AI brief of your work threads.</div>';
        return;
      }

      const attention = (brief.attention || [])
        .map((entry) =>
          linkHtml({
            title: entry.text,
            url: entry.url,
            detail: hostOf(entry.url),
          }),
        )
        .join("");
      const threads = brief.threads
        .map((thread) =>
          cardHtml({
            title: thread.title,
            note: thread.note,
            links: thread.links,
          }),
        )
        .join("");
      const sources = sourcesText(brief.sources);

      elements.brief.innerHTML = `
    ${
      (brief.attention || []).length
        ? `<a class="brief-takeaway" href="${escapeHtml(brief.attention[0].url)}"${openTabAttributes(state.openByUrl.get(normalizeUrlForDuplicate(brief.attention[0].url)))}><span class="takeaway-label">Worth a look</span><span>${escapeHtml(brief.attention[0].text)}</span><span aria-hidden="true">↗</span></a>`
        : `<p class="brief-headline">${escapeHtml(brief.headline || "No attention items in your latest brief.")}</p>`
    }
    <button class="brief-toggle" type="button" aria-expanded="${state.briefExpanded}" aria-controls="briefDetails" data-brief-toggle>
      ${state.briefExpanded ? "Hide details" : `View brief · ${(brief.attention || []).length} attention items · ${brief.threads.length} threads`}
      <span aria-hidden="true">${state.briefExpanded ? "−" : "+"}</span>
    </button>
    <div id="briefDetails"${state.briefExpanded ? "" : " hidden"}>
    ${(brief.attention || []).length && brief.headline ? `<p class="brief-headline">${escapeHtml(brief.headline)}</p>` : ""}
    ${attention ? `<div class="attention"><h3 class="attention-title">Needs attention</h3>${attention}</div>` : ""}
    ${threads ? `<div class="card-grid">${threads}</div>` : '<div class="empty">No clear work threads right now.</div>'}
    ${sources ? `<p class="brief-sources">${escapeHtml(sources)}</p>` : ""}
    </div>
  `;
    }

    // The build runs in the background worker and reports through storage, so it
    // survives this tab closing and shows up in every other new tab.
    async function buildBrief() {
      state.build = { status: "running", phase: "history" };
      renderBrief();

      try {
        await chrome.runtime.sendMessage({ type: messages.buildBrief });
      } catch (error) {
        state.build = {
          status: "failed",
          error: "Background worker did not respond",
          finishedAt: Date.now(),
        };
        renderBrief();
        console.error(error);
      }
    }

    return { renderBrief, buildBrief };
  },
);
