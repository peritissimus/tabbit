const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeAiSettings, buildJsonRequest } = require("../src/ai-config");

test("migrates legacy models to the split without losing the key or context", () => {
  const settings = normalizeAiSettings({ apiKey: "dummy-key", model: "gpt-5.4-nano", context: "My work" });
  assert.equal(settings.apiKey, "dummy-key");
  assert.equal(settings.context, "My work");
  assert.equal(settings.model, "gpt-6-luna");
  assert.equal(settings.briefModel, "gpt-6.1-sol");
  assert.deepEqual(normalizeAiSettings(settings), settings);
});

test("routes grouping and selection to Luna and writing to Sol", () => {
  const settings = normalizeAiSettings();
  const messages = [{ role: "user", content: "Return JSON" }];
  for (const task of ["grouping", "selection"]) {
    const request = buildJsonRequest(messages, settings, task);
    assert.equal(request.model, "gpt-6-luna");
    assert.equal(request.reasoning_effort, "low");
    assert.equal(request.max_completion_tokens, 4096);
    assert.deepEqual(request.messages, messages);
    assert.equal(request.response_format.type, "json_object");
  }
  const brief = buildJsonRequest(messages, settings, "brief");
  assert.equal(brief.model, "gpt-6.1-sol");
  assert.equal(brief.reasoning_effort, "medium");
  assert.equal(brief.max_completion_tokens, 8192);
});

test("preserves later per-task overrides without adding GPT-6 parameters to other models", () => {
  const settings = normalizeAiSettings({ modelRoutingVersion: 1, model: " gpt-4.1-mini ", briefModel: "gpt-6.1-sol" });
  assert.equal(buildJsonRequest([], settings).model, "gpt-4.1-mini");
  assert.equal(buildJsonRequest([], settings).reasoning_effort, undefined);
  assert.equal(buildJsonRequest([], settings, "brief").model, "gpt-6.1-sol");
});
