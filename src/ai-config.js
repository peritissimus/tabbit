(function initAiConfig(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TabbitAiConfig = factory();
  }
})(typeof self !== "undefined" ? self : this, function createAiConfig() {
  const DEFAULT_AI_MODEL = "gpt-6-luna";
  const DEFAULT_BRIEF_MODEL = "gpt-6.1-sol";
  const MODEL_ROUTING_VERSION = 1;

  function normalizeAiSettings(settings = {}) {
    // The previous single-model setting cannot express the requested split.
    // Migrate it once; preserve explicit per-task overrides after that.
    const migrated = settings.modelRoutingVersion === MODEL_ROUTING_VERSION;
    const model = (value, fallback) => typeof value === "string" && value.trim() ? value.trim() : fallback;
    return {
      apiKey: typeof settings.apiKey === "string" ? settings.apiKey : "",
      context: typeof settings.context === "string" ? settings.context : "",
      model: migrated ? model(settings.model, DEFAULT_AI_MODEL) : DEFAULT_AI_MODEL,
      briefModel: migrated ? model(settings.briefModel, DEFAULT_BRIEF_MODEL) : DEFAULT_BRIEF_MODEL,
      modelRoutingVersion: MODEL_ROUTING_VERSION
    };
  }

  function buildJsonRequest(messages, settings, task = "grouping") {
    const normalized = normalizeAiSettings(settings);
    const brief = task === "brief";
    const model = brief ? normalized.briefModel : normalized.model;
    return {
      model,
      messages,
      max_completion_tokens: brief ? 8192 : 4096,
      response_format: { type: "json_object" },
      ...(/^gpt-6(?:[.-]|$)/.test(model) ? { reasoning_effort: brief ? "medium" : "low" } : {})
    };
  }

  return { DEFAULT_AI_MODEL, DEFAULT_BRIEF_MODEL, MODEL_ROUTING_VERSION, normalizeAiSettings, buildJsonRequest };
});
