const test = require("node:test");
const assert = require("node:assert/strict");
const create = require("../src/organization-workflow");
const organizer = require("../src/organizer");
const prompt = require("../src/grouping-prompt");
const config = require("../src/ai-config");
const { keys } = require("../src/contracts");
function fixture(settings = {}) {
  const saved = {},
    calls = [];
  const tabs = [1, 2, 3].map((id) => ({
    id,
    windowId: 4,
    index: id,
    url: `https://github.com/org/repo${id}`,
    title: "Repo",
    pinned: id === 3,
  }));
  const chrome = {
    storage: { local: { set: async (v) => Object.assign(saved, v) } },
    tabs: {
      query: async () => tabs,
      group: async (value) => {
        calls.push(value);
        return 10;
      },
    },
    tabGroups: { update: async () => {} },
  };
  const deps = {
    chrome,
    store: { getAiSettings: async () => config.normalizeAiSettings(settings) },
    config,
    keys,
    organizer,
    prompt,
    grouping: {
      run: async () => ({
        status: "done",
        groups: [{ title: "Code", color: "blue", tabIds: [1, 2, 3, 99] }],
      }),
    },
  };
  return { deps, saved, calls, tabs };
}
test("local organization stays in the selected window and excludes pinned tabs", async () => {
  const f = fixture();
  await create(f.deps).run(4);
  assert.deepEqual(f.calls, [
    { createProperties: { windowId: 4 }, tabIds: [1, 2] },
  ]);
  assert.equal(f.saved["tabbit.organization.4"].status, "done");
});
test("organization is single-flight and revalidates tabs after AI completes", async () => {
  const f = fixture({ provider: "claude" });
  let release;
  f.deps.grouping.run = async (request) => {
    assert.match(request.requestBody.messages[0].content, /Allowed colors/);
    await new Promise((r) => (release = r));
    return {
      status: "done",
      groups: [{ title: "Code", tabIds: [1, 2, 3, 99] }],
    };
  };
  const service = create(f.deps);
  const first = service.run(4);
  assert.equal(service.run(4), first);
  while (!release) await new Promise((r) => setImmediate(r));
  f.tabs.splice(1, 1);
  release();
  await first;
  assert.deepEqual(f.calls[0].tabIds, [1]);
  assert.equal(f.saved["tabbit.organization.4"].status, "done");
});
test("AI errors persist as failures without changing tabs", async () => {
  const f = fixture({ provider: "claude" });
  f.deps.grouping.run = async () => ({
    status: "failed",
    error: "Usage limit reached",
  });
  await create(f.deps).run(4);
  assert.equal(f.calls.length, 0);
  assert.match(f.saved["tabbit.organization.4"].message, /Usage limit/);
});
test("shared grouping prompt omits URL queries and pinned tabs", () => {
  const messages = prompt.buildAiMessages(
    [
      {
        id: 1,
        windowId: 4,
        url: "https://example.com/path?secret=x#hash",
        title: "Example",
      },
      { id: 2, pinned: true, url: "https://example.com/" },
    ],
    {},
    {},
  );
  const input = JSON.parse(messages[1].content);
  assert.equal(input.tabs.length, 1);
  assert.equal(input.tabs[0].url, "https://example.com/path");
});
test("model dropdown preserves configured overrides without mixing providers", () => {
  const select = {
    ownerDocument: { createElement: () => ({}) },
    replaceChildren(...items) {
      this.items = items;
    },
  };
  config.populateModelSelect(select, "claude", "claude-custom");
  assert.deepEqual(
    select.items.map((i) => i.value),
    ["sonnet", "opus", "claude-custom"],
  );
  assert.equal(select.value, "claude-custom");
  config.populateModelSelect(select, "codex", "gpt-6-luna");
  assert.deepEqual(
    select.items.map((i) => i.value),
    ["gpt-6-luna", "gpt-6.1-sol"],
  );
});
