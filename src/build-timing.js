(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TabbitBuildTiming = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function update(previous, patch, now = Date.now()) {
    const next = { ...previous, ...patch };
    const timings = { ...(previous?.timings || {}) };
    if (previous?.phase && previous.phase !== next.phase && Number.isFinite(previous.phaseStartedAt)) {
      timings[previous.phase] = (timings[previous.phase] || 0) + Math.max(0, now - previous.phaseStartedAt);
    }
    next.timings = timings;
    next.phaseStartedAt = next.phase ? (next.phase === previous?.phase ? previous.phaseStartedAt : now) : null;
    if (next.status !== "running" && Number.isFinite(next.startedAt) && Number.isFinite(next.finishedAt)) {
      next.durationMs = Math.max(0, next.finishedAt - next.startedAt);
    }
    return next;
  }
  const labels = {history:"Browser history",choosing:"Model: selection",reading:"Source reading",writing:"Model: brief writing",curating:"Model: feed curation"};
  const seconds = ms => `${(ms / 1000).toFixed(1)}s`;
  function describe(build) {
    if (!Number.isFinite(build?.durationMs)) return null;
    const entries = Object.entries(build.timings || {}).filter(([,ms])=>Number.isFinite(ms));
    const longest = [...entries].sort((a,b)=>b[1]-a[1])[0];
    return {
      summary: `${build.status === "failed" ? "Failed after" : "Built in"} ${seconds(build.durationMs)}`,
      detail: [
        `Attempt ${build.attempt || 1} · ${new Date(build.startedAt).toLocaleString()}`,
        ...entries.map(([phase,ms])=>`${labels[phase] || phase}: ${seconds(ms)}`),
        longest ? `Longest stage: ${labels[longest[0]] || longest[0]}` : "",
        "Wall-clock time for this attempt; overlapping reads are counted once."
      ].filter(Boolean).join("\n")
    };
  }
  function render(element, build) {
    const timing = describe(build);
    element.hidden = !timing || build.status === "running";
    if (timing) {
      element.querySelector("summary").textContent = timing.summary;
      element.querySelector("pre").textContent = timing.detail;
    }
  }
  return {update, describe, render};
});
