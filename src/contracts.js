// Stable storage and message names shared by worker and UI.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else /** @type {any} */ (root).TabbitContracts = factory();
})(typeof self !== "undefined" ? self : this, function () {
  return Object.freeze({
    keys: Object.freeze({
      aiSettings: "tabbit.aiSettings",
      brief: "tabbit.brief",
      build: "tabbit.build",
      plan: "tabbit.plan",
      feed: "tabbit.feed",
      feedBuild: "tabbit.feedBuild",
      feedPreferences: "tabbit.feedPreferences",
      feedFeedback: "tabbit.feedFeedback",
      sessions: "tabbit.sessions",
      shortcuts: "tabbit.shortcuts",
      newtabSnapshot: "tabbit.newtabSnapshot",
      uiState: "tabbit.uiState",
    }),
    messages: Object.freeze({
      buildFeed: "tabbit.buildFeed",
      feedFeedback: "tabbit.feedFeedback",
      feedPreferences: "tabbit.feedPreferences",
      requestPlan: "tabbit.requestPlan",
      buildBrief: "tabbit.buildBrief",
      wake: "tabbit.wake",
    }),
  });
});
