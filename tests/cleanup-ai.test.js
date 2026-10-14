const test = require("node:test"),
  assert = require("node:assert/strict");
const cleanupAI = require("../src/cleanup-ai"),
  organizer = require("../src/organizer");
const create = require("../src/cleanup-workflow"),
  { keys } = require("../src/contracts");
const tab = (id, url = `https://example.com/${id}`) => ({
  id,
  url,
  title: `Reference ${id}`,
  windowId: 9,
  lastAccessed: 1,
});
test("AI reasons require real replacement IDs, exclude review pages, localhost, invented IDs and cycles", async () => {
  const tabs = [
    tab(1),
    tab(2),
    tab(3, "https://github.com/org/repo/pull/123/files"),
    tab(4, "http://localhost:3000"),
    { ...tab(5), active: true },
  ];
  const r = await cleanupAI.suggest({
    tabs,
    settings: {},
    organizer,
    ai: {
      requestJson: async (messages) => {
        const input = JSON.parse(messages[1].content);
        assert.ok(!input.tabs.some((t) => t.id === 3));
        return {
          suggestions: [
            {
              tabId: 1,
              replacementTabId: 2,
              reason: "This reference overlaps the retained reference.",
            },
            {
              tabId: 3,
              replacementTabId: 2,
              reason: "A PR title is not evidence that review is done.",
            },
            {
              tabId: 4,
              replacementTabId: 2,
              reason: "Do not close development servers.",
            },
            {
              tabId: 5,
              replacementTabId: 2,
              reason: "Do not close active pages.",
            },
            {
              tabId: 99,
              replacementTabId: 2,
              reason: "Invented ID must be rejected.",
            },
            {
              tabId: 2,
              replacementTabId: 999,
              reason: "Invented replacement rejected.",
            },
          ],
        };
      },
    },
  });
  assert.deepEqual(
    r.items.map((t) => t.id),
    [1],
  );
  assert.equal(r.reviewCount, 1);
  assert.match(r.items[0].explanation, /overlaps/);
});
test("large windows are fully batched and sensitive URL components are excluded", async () => {
  const tabs = Array.from({ length: 135 }, (_, i) => tab(i + 1));
  tabs[0].url = "https://user:pass@example.com/page?token=secret#fragment";
  const seen = [];
  let calls = 0;
  await cleanupAI.suggest({
    tabs,
    settings: {},
    organizer,
    ai: {
      requestJson: async (messages) => {
        calls++;
        const input = JSON.parse(messages[1].content);
        seen.push(...input.tabs.map((t) => t.id));
        assert.ok(!messages[1].content.includes("secret"));
        assert.ok(!messages[1].content.includes("user:pass"));
        return { suggestions: [] };
      },
    },
  });
  assert.equal(calls, 3);
  assert.equal(new Set(seen).size, 135);
});
test("provider failure is disclosed without inventing suggestions", async () => {
  const r = await cleanupAI.suggest({
    tabs: [tab(1)],
    settings: {},
    organizer,
    ai: {
      requestJson: async () => {
        throw Error("offline");
      },
    },
  });
  assert.equal(r.items.length, 0);
  assert.match(r.warning, /failed/);
});
test("AI plan survives reopen and cannot close a PR, visited suggestion, or a tab whose replacement disappeared", async () => {
  const saved = {};
  let calls = 0;
  let tabs = [
    tab(1),
    tab(2),
    tab(3, "https://github.com/org/repo/pull/123"),
    tab(4, "https://github.com/org/repo/pull/124"),
  ];
  const chrome = {
    runtime: { getURL: (p) => "chrome-extension://tabbit/" + p },
    storage: {
      local: {
        get: async (k) => ({ [k]: saved[k] }),
        set: async (values) => Object.assign(saved, structuredClone(values)),
      },
    },
    tabs: {
      query: async () => tabs,
      get: async (id) => tabs.find((t) => t.id === id),
      remove: async () => assert.fail("must not close"),
    },
  };
  const deps = {
    chrome,
    organizer,
    keys,
    cleanupAI,
    store: { getAiSettings: async () => ({ provider: "claude" }) },
    config: { hasAiAccess: () => true },
    ai: {
      requestJson: async () => {
        calls++;
        return {
          suggestions: [
            {
              tabId: 1,
              replacementTabId: 2,
              reason: "Overlapping reference; retain the other entry.",
            },
          ],
        };
      },
    },
  };
  const service = create(deps),
    p = await service.run(9, 99, { action: "preview" });
  assert.deepEqual(
    p.items.map((t) => t.id),
    [1],
  );
  assert.equal(p.reviewCount, 2);
  const reopened = await create(deps).run(9, 99, { action: "load" });
  assert.equal(reopened.token, p.token);
  assert.equal(calls, 1);
  tabs[0].lastAccessed = Date.now();
  await assert.rejects(
    service.run(9, 99, { action: "close", token: p.token, ids: [1] }),
    /eligible/,
  );
  tabs[0].lastAccessed = 1;
  tabs = tabs.filter((t) => t.id !== 2);
  await assert.rejects(
    service.run(9, 99, { action: "close", token: p.token, ids: [1] }),
    /eligible/,
  );
});
test("different PR comments and diffs are not collapsed as duplicates; exact copies may be", () => {
  const service = create({
    chrome: { runtime: { getURL: (p) => "chrome-extension://tabbit/" + p } },
    organizer,
    keys,
  });
  const tabs = [
    tab(1, "https://github.com/a/b/pull/1#comment-1"),
    tab(2, "https://github.com/a/b/pull/1#comment-2"),
    tab(3, "https://github.com/a/b/pull/1/files?diff=split"),
    tab(4, "https://github.com/a/b/pull/1/files?diff=unified"),
    tab(5, "https://github.com/a/b/pull/2"),
    tab(6, "https://github.com/a/b/pull/2"),
  ];
  assert.deepEqual(
    service.candidates(tabs, 99).map((t) => t.id),
    [6],
  );
});
