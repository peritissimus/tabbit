const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildGroupingPlanFromAiGroups,
  buildGroupingPlan,
  categorizeTab,
  findDuplicateTabs,
  normalizeUrlForDuplicate
} = require("../src/organizer");

function tab(overrides) {
  return {
    active: false,
    groupId: -1,
    id: overrides.id,
    index: overrides.index ?? overrides.id,
    pinned: false,
    title: overrides.title || "Untitled",
    url: overrides.url,
    windowId: overrides.windowId ?? 1,
    ...overrides
  };
}

test("categorizes common work and code tabs by hostname", () => {
  assert.equal(
    categorizeTab(tab({ id: 1, title: "Pull request", url: "https://github.com/org/repo/pull/1" })).title,
    "Code"
  );
  assert.equal(
    categorizeTab(tab({ id: 2, title: "Issue", url: "https://linear.app/team/issue/TAB-1" })).title,
    "Work"
  );
});

test("builds validated group plans from Groq output", () => {
  const tabs = [
    tab({ id: 1, title: "Project API", url: "https://github.com/acme/api", windowId: 1 }),
    tab({ id: 2, title: "Project Docs", url: "https://docs.acme.com/api", windowId: 1 }),
    tab({ id: 3, title: "Project Local", url: "http://localhost:3000", windowId: 2 }),
    tab({ id: 4, title: "Project Issue", url: "https://linear.app/acme/issue/TAB-1", windowId: 2 }),
    tab({ id: 5, title: "Other Issue", url: "https://linear.app/acme/issue/TAB-2", windowId: 2 }),
    tab({ id: 6, title: "Pinned", pinned: true, url: "https://github.com/acme/pinned", windowId: 1 })
  ];

  const plan = buildGroupingPlanFromAiGroups(
    tabs,
    [
      {
        color: "not-a-color",
        tabIds: [1, 2, 3, 4, 5, 999],
        title: "Launch work"
      },
      {
        color: "blue",
        tabIds: [1, 6],
        title: "Duplicate ids"
      }
    ],
    { minGroupSize: 2 }
  );

  assert.equal(plan.groups.length, 3);
  assert.deepEqual(
    plan.groups.map((group) => group.tabs.map((item) => item.id)),
    [[1, 2], [3], [4, 5]]
  );
  assert.deepEqual(
    plan.groups.map((group) => group.title),
    ["Launch work", "Local", "Launch work"]
  );
  assert.deepEqual(
    plan.groups.map((group) => group.color),
    ["grey", "cyan", "grey"]
  );
  assert.equal(plan.skippedCount, 1);
});

test("always groups localhost tabs even with a single tab", () => {
  const tabs = [
    tab({ id: 1, title: "Dev server", url: "http://localhost:5173", windowId: 1 }),
    tab({ id: 2, title: "GitHub", url: "https://github.com/org/repo", windowId: 1 }),
    tab({ id: 3, title: "Docs", url: "https://developer.mozilla.org/", windowId: 1 })
  ];

  const plan = buildGroupingPlan(tabs, { minGroupSize: 2 });
  const localGroup = plan.groups.find((group) => group.title === "Local");

  assert.ok(localGroup, "Local group must exist when at least one localhost tab is present");
  assert.deepEqual(localGroup.tabs.map((item) => item.id), [1]);
  assert.equal(localGroup.color, "cyan");
});

test("preserves AI singletons (AI decides when a single tab deserves its own group)", () => {
  const tabs = [
    tab({ id: 1, title: "Vapi dashboard", url: "https://dashboard.vapi.ai/", windowId: 1 }),
    tab({ id: 2, title: "Repo", url: "https://github.com/org/repo", windowId: 1 }),
    tab({ id: 3, title: "PR #1", url: "https://github.com/org/repo/pull/1", windowId: 1 }),
    tab({ id: 4, title: "YouTube", url: "https://www.youtube.com/watch?v=abc", windowId: 1 })
  ];

  const plan = buildGroupingPlanFromAiGroups(
    tabs,
    [
      { color: "purple", tabIds: [1], title: "Vapi" },
      { color: "grey", tabIds: [2, 3], title: "Code" },
      { color: "red", tabIds: [4], title: "YouTube" }
    ],
    { minGroupSize: 2 }
  );

  assert.equal(plan.groups.length, 3);
  const titles = plan.groups.map((group) => group.title);
  assert.ok(titles.includes("Vapi"));
  assert.ok(titles.includes("YouTube"));
  const vapi = plan.groups.find((group) => group.title === "Vapi");
  assert.deepEqual(vapi.tabs.map((item) => item.id), [1]);
});

test("localhost override applies to AI plans too, regardless of where AI placed it", () => {
  const tabs = [
    tab({ id: 1, title: "Dev", url: "http://127.0.0.1:3000", windowId: 1 }),
    tab({ id: 2, title: "Docs", url: "https://docs.acme.com/", windowId: 1 }),
    tab({ id: 3, title: "Repo", url: "https://github.com/acme/api", windowId: 1 })
  ];

  const plan = buildGroupingPlanFromAiGroups(
    tabs,
    [{ color: "blue", tabIds: [1, 2, 3], title: "Everything" }],
    { minGroupSize: 2 }
  );

  const localGroup = plan.groups.find((group) => group.title === "Local");
  const everythingGroup = plan.groups.find((group) => group.title === "Everything");

  assert.ok(localGroup, "Local group must be produced from localhost tab");
  assert.deepEqual(localGroup.tabs.map((item) => item.id), [1]);
  assert.ok(everythingGroup, "AI group is kept for the remaining tabs");
  assert.deepEqual(everythingGroup.tabs.map((item) => item.id), [2, 3]);
});

test("builds native tab group plans per window and minimum group size", () => {
  const tabs = [
    tab({ id: 1, url: "https://github.com/org/repo" }),
    tab({ id: 2, url: "https://github.com/org/repo/pull/1" }),
    tab({ id: 3, url: "https://developer.chrome.com/docs/extensions" }),
    tab({ id: 4, url: "https://developer.mozilla.org/en-US/docs/Web/API" }),
    tab({ id: 5, url: "chrome://extensions" }),
    tab({ id: 6, pinned: true, url: "https://github.com/org/repo/issues" })
  ];

  const plan = buildGroupingPlan(tabs, { minGroupSize: 2 });

  assert.equal(plan.groups.length, 2);
  assert.deepEqual(
    plan.groups.map((group) => group.title),
    ["Code", "Docs"]
  );
  assert.deepEqual(
    plan.groups[0].tabs.map((item) => item.id),
    [1, 2]
  );
  assert.equal(plan.skippedCount, 2);
});

test("can include pinned tabs when explicitly requested", () => {
  const tabs = [
    tab({ id: 1, url: "https://github.com/org/repo" }),
    tab({ id: 2, pinned: true, url: "https://github.com/org/repo/issues" })
  ];

  const plan = buildGroupingPlan(tabs, { includePinned: true, minGroupSize: 2 });

  assert.equal(plan.groups.length, 1);
  assert.deepEqual(
    plan.groups[0].tabs.map((item) => item.id),
    [1, 2]
  );
});

test("normalizes duplicate URLs by removing fragments and tracking params", () => {
  assert.equal(
    normalizeUrlForDuplicate("https://example.com/page/?utm_source=x&b=2&a=1#section"),
    "https://example.com/page?a=1&b=2"
  );
});

test("finds duplicates while keeping active or pinned tabs", () => {
  const tabs = [
    tab({ id: 1, url: "https://example.com/page?utm_source=newsletter" }),
    tab({ active: true, id: 2, url: "https://example.com/page#intro" }),
    tab({ id: 3, pinned: true, url: "https://example.com/other" }),
    tab({ id: 4, url: "https://example.com/other/" })
  ];

  const duplicates = findDuplicateTabs(tabs, { includePinned: true });

  assert.equal(duplicates.duplicateSets.length, 2);
  assert.deepEqual(
    duplicates.removableTabs.map((item) => item.id).sort(),
    [1, 4]
  );
  assert.equal(duplicates.duplicateSets[0].keeper.id, 2);
  assert.equal(duplicates.duplicateSets[1].keeper.id, 3);
});
