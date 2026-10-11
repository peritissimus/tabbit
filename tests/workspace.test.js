const assert = require("node:assert/strict");
const test = require("node:test");

const {
  addPageLinks,
  buildBriefFromAi,
  buildBriefItems,
  buildWorkspace,
  categorizeSite,
  isReadableUrl,
  parseInternalDomains,
  selectPagesToRead
} = require("../src/workspace");

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

function visit(url, overrides = {}) {
  return {
    lastVisitTime: NOW - DAY,
    title: "Untitled",
    url,
    visitCount: 3,
    ...overrides
  };
}

test("reads internal domains from wildcard patterns in the context", () => {
  assert.deepEqual(
    parseInternalDomains("dev at Acme; AWS infra, *.acme.dev internal tools, *.Acme.ai, github.com"),
    ["acme.dev", "acme.ai"]
  );
  assert.deepEqual(parseInternalDomains(""), []);
});

test("categorizes sites by host, with internal domains taking priority", () => {
  assert.equal(categorizeSite("us-east-1.console.aws.amazon.com"), "Infra");
  assert.equal(categorizeSite("www.github.com"), "Code");
  assert.equal(categorizeSite("mail.google.com"), "Comms");
  assert.equal(categorizeSite("gemini.google.com"), "AI");
  assert.equal(categorizeSite("docs.stripe.com"), "Docs");
  assert.equal(categorizeSite("example.com"), "Other");
  assert.equal(categorizeSite("www.google.com"), null);
  assert.equal(categorizeSite("grafana.acme.dev", ["acme.dev"]), "Internal");
});

test("groups history into ranked categories and separates local servers", () => {
  const workspace = buildWorkspace(
    [
      visit("https://github.com/org/repo/pull/1", { title: "PR 1", visitCount: 12 }),
      visit("https://github.com/org/repo/pull/1#discussion", { title: "PR 1 (old)", lastVisitTime: NOW - 3 * DAY }),
      visit("https://github.com/org/repo/issues", { title: "Issues" }),
      visit("https://admin.acme.dev/users", { title: "Admin" }),
      visit("https://www.google.com/search?q=tabs", { visitCount: 40 }),
      visit("https://once.example.com/", { visitCount: 1 }),
      visit("http://localhost:3000/dashboard", { title: "Dashboard" }),
      visit("http://localhost:3000/", { title: "Home", lastVisitTime: NOW - 2 * DAY }),
      visit("http://127.0.0.1:8080/docs", { title: "API docs", lastVisitTime: NOW - 5 * DAY }),
      visit("chrome://extensions/")
    ],
    { internalDomains: ["acme.dev"], now: NOW }
  );

  assert.deepEqual(
    workspace.categories.map((category) => category.title),
    ["Internal", "Code"]
  );

  const [github] = workspace.categories[1].sites;
  assert.equal(github.host, "github.com");
  assert.equal(github.visits, 18);
  assert.deepEqual(
    github.pages.map((page) => [page.title, page.visits]),
    [
      ["PR 1", 15],
      ["Issues", 3]
    ]
  );

  assert.deepEqual(
    workspace.localServers.map((server) => [server.label, server.title, server.visits]),
    [
      ["localhost:3000", "Dashboard", 6],
      ["127.0.0.1:8080", "API docs", 3]
    ]
  );

  assert.equal(workspace.siteCount, 2);
  assert.ok(workspace.pages.some((page) => page.host === "localhost"));
  assert.ok(workspace.pages.every((page) => page.host !== "google.com"));
});

test("builds brief items from open tabs first without repeating pages", () => {
  const tabs = [
    { id: 7, title: "PR 1", url: "https://github.com/org/repo/pull/1", windowId: 1 },
    { id: 8, title: "New Tab", url: "chrome://newtab/", windowId: 1 }
  ];
  const pages = [
    { title: "PR 1", url: "https://github.com/org/repo/pull/1#files", visits: 9 },
    { title: "Admin", url: "https://admin.acme.dev/users", visits: 4, lastVisitTime: 50 }
  ];

  assert.deepEqual(buildBriefItems(tabs, pages), [
    { id: 1, title: "PR 1", url: "https://github.com/org/repo/pull/1", open: true, visits: 0, lastVisitTime: 0 },
    { id: 2, title: "Admin", url: "https://admin.acme.dev/users", open: false, visits: 4, lastVisitTime: 50 }
  ]);
});

test("keeps only brief links the model was actually given", () => {
  const items = [
    { id: 1, title: "PR 1", url: "https://github.com/org/repo/pull/1" },
    { id: 2, title: "Admin", url: "https://admin.acme.dev/users" }
  ];

  const brief = buildBriefFromAi(
    {
      headline: "  Shipping   the admin fix ",
      attention: [
        { text: "Review requested on PR 1", itemId: 1 },
        { text: "Made up", itemId: 77 },
        { itemId: 2 }
      ],
      threads: [
        { title: "Admin fix", note: "Review is pending.", itemIds: [1, "2", 99, 1] },
        { title: "Reused", itemIds: [2] },
        { title: "Invented", itemIds: [42] },
        { note: "No title", itemIds: [] }
      ]
    },
    items
  );

  assert.deepEqual(brief, {
    headline: "Shipping the admin fix",
    attention: [{ text: "Review requested on PR 1", title: "PR 1", url: "https://github.com/org/repo/pull/1" }],
    threads: [
      {
        title: "Admin fix",
        note: "Review is pending.",
        links: [
          { title: "PR 1", url: "https://github.com/org/repo/pull/1" },
          { title: "Admin", url: "https://admin.acme.dev/users" }
        ]
      }
    ]
  });

  assert.deepEqual(buildBriefFromAi(null, items), { headline: "", attention: [], threads: [] });
});

test("refuses to read private or action-like pages", () => {
  assert.equal(isReadableUrl("https://github.com/pulls"), true);
  assert.equal(isReadableUrl("http://localhost:3000/"), true);
  assert.equal(isReadableUrl("https://mail.google.com/mail/u/0/"), false);
  assert.equal(isReadableUrl("https://www.mybank.com/accounts"), false);
  assert.equal(isReadableUrl("https://app.example.com/logout"), false);
  assert.equal(isReadableUrl("https://app.example.com/invite?action=confirm"), false);
  assert.equal(isReadableUrl("file:///Users/me/notes.html"), false);
  assert.equal(isReadableUrl("not a url"), false);
});

test("reads the pages the model picked, or the top readable ones if the pick failed", () => {
  const items = [
    { id: 1, url: "https://mail.google.com/mail/u/0/" },
    { id: 2, url: "https://github.com/pulls" },
    { id: 3, url: "https://linear.app/acme/inbox" },
    { id: 4, url: "https://admin.acme.dev/users" }
  ];
  const ids = (selected) => selected.map((item) => item.id);

  assert.deepEqual(ids(selectPagesToRead([3, 1, "2", 99], items)), [2, 3]);
  assert.deepEqual(ids(selectPagesToRead([2, 3, 4], items, { maxPages: 2 })), [2, 3]);
  assert.deepEqual(ids(selectPagesToRead([], items)), []);
  assert.deepEqual(ids(selectPagesToRead(null, items, { fallbackPages: 2 })), [2, 3]);
});

test("turns links found on read pages into items without duplicating known pages", () => {
  const items = [
    { id: 1, title: "Pull requests", url: "https://github.com/pulls" },
    { id: 2, title: "PR 1", url: "https://github.com/org/repo/pull/1" }
  ];

  const linked = addPageLinks(items, [
    {
      title: "Pull requests",
      links: [
        { title: "Fix admin crash", url: "https://github.com/org/repo/pull/1#top" },
        { title: "Add   billing export", url: "https://github.com/org/repo/pull/2" },
        { title: "Add billing export", url: "https://github.com/org/repo/pull/2" },
        { title: "", url: "https://github.com/org/repo/pull/3" },
        { title: "Mail me", url: "mailto:me@example.com" }
      ]
    }
  ]);

  assert.deepEqual(linked.pages[0].links, [
    { id: 2, title: "Fix admin crash" },
    { id: 3, title: "Add billing export" }
  ]);
  assert.equal(linked.items.length, 3);
  assert.equal(linked.items[2].url, "https://github.com/org/repo/pull/2");
  assert.equal(items.length, 2);
});


test("excludes authentication handoffs from recommended pages, dev servers, and AI candidates", () => {
  const urls = [
    "http://127.0.0.1:53281/oauth/callback?code=dummy&state=test",
    "https://app.example.com/login",
    "https://app.example.com/?access_token=dummy",
    "https://portal.example.com/start/#/?callback_url=https://example.com",
    "http://localhost:4200/dashboard",
    "https://docs.example.com/oauth-guide"
  ];
  const workspace = buildWorkspace(urls.map((url) => visit(url)), { now: NOW });
  assert.deepEqual(workspace.localServers.map((server) => server.url), [urls[4]]);
  assert.deepEqual(new Set(workspace.pages.map((page) => page.url)), new Set(urls.slice(4)));
  assert.deepEqual(buildBriefItems(urls.map((url, id) => ({ id, url })), []).map((item) => item.url), urls.slice(4));
});
