const test = require("node:test"),
  assert = require("node:assert/strict");
const create = require("../src/cleanup-workflow"),
  organizer = require("../src/organizer");
const { keys } = require("../src/contracts");
function fixture() {
  const state = {},
    removed = [],
    windows = [];
  let tabs = [
    { id: 1, url: "chrome://newtab/", active: true },
    { id: 2, url: "chrome://newtab/" },
    { id: 3, url: "https://example.com/a", lastAccessed: Date.now() },
    { id: 4, url: "https://example.com/a", lastAccessed: 1 },
    { id: 5, url: "https://unused.example/", lastAccessed: 1 },
    { id: 6, url: "https://pinned.example/", pinned: true, lastAccessed: 1 },
    { id: 7, url: "https://music.example/", audible: true, lastAccessed: 1 },
  ].map((t) => ({ windowId: 9, title: "Tab " + t.id, ...t }));
  const chrome = {
    runtime: { getURL: (path) => "chrome-extension://tabbit/" + path },
    storage: {
      local: {
        get: async (key) => ({ [key]: state[key] }),
        set: async (values) => Object.assign(state, structuredClone(values)),
      },
    },
    tabs: {
      query: async () => tabs,
      get: async (id) => tabs.find((t) => t.id === id),
      remove: async (id) => {
        assert.ok(state[keys.sessions]?.length, "backup before close");
        removed.push(id);
        tabs = tabs.filter((t) => t.id !== id);
      },
    },
    windows: { create: async (options) => windows.push(options) },
  };
  const service = create({ chrome, organizer, keys, store:{getAiSettings:async()=>({provider:'codex'})}, config:{hasAiAccess:()=>true}, cleanupAI:require('../src/cleanup-ai'),ai:{requestJson:async()=>({suggestions:[{tabId:5,replacementTabId:3,reason:'Overlapping reference entry; keep the current reference tab.'}]})} });
  return {
    service,
    state,
    removed,
    windows,
    chrome,
    tabs,
    preview: () => service.run(9, 1, { action: "preview", days: 7 }),
  };
}
test("preview partitions candidates and protects active, pinned, audible and duplicate keeper tabs", async () => {
  const f = fixture(),
    p = await f.preview();
  assert.deepEqual(
    p.items.map((t) => [t.id, t.reason]),
    [
      [2, "Extra new tabs"],
      [4, "Duplicate pages"],
      [5, "AI suggestions"],
    ],
  );
  assert.equal(f.removed.length, 0);
});
test("selected cleanup persists backup, deduplicates IDs, restores once, and survives a new workflow instance", async () => {
  const f = fixture(),
    p = await f.preview();
  const result = await f.service.run(9, 1, {
    action: "close",
    token: p.token,
    ids: [2, 4, 4, 999],
  });
  assert.equal(result.closed, 2);
  assert.deepEqual(f.removed, [2, 4]);
  const again = await f.service.run(9, 1, {
    action: "close",
    token: p.token,
    ids: [2, 4],
  });
  assert.equal(again.closed, 2);
  assert.equal(f.removed.length, 2);
  const restarted = create({ chrome: f.chrome, organizer, keys });
  await restarted.run(9, 1, { action: "restore" });
  assert.deepEqual(f.windows[0].url, [
    "chrome://newtab/",
    "https://example.com/a",
  ]);
  await assert.rejects(restarted.run(9, 1, { action: "restore" }));
});
test("changed tabs and protected tabs cannot be closed from a stale preview", async () => {
  const f = fixture(),
    p = await f.preview();
  f.tabs.find((t) => t.id === 2).pendingUrl = "https://new.example/";
  f.tabs.find((t) => t.id === 4).active = true;
  const r = await f.service.run(9, 1, {
    action: "close",
    token: p.token,
    ids: [2, 4, 5],
  });
  assert.deepEqual(f.removed, [5]);
  assert.equal(r.skipped, 2);
  assert.equal(f.state[keys.sessions][0].tabs.length, 1);
});
test("backup failure prevents all closing; expired and invented previews are rejected", async () => {
  const f = fixture(),
    p = await f.preview();
  await assert.rejects(
    f.service.run(9, 1, { action: "close", token: "bad", ids: [2] }),
  );
  f.chrome.storage.local.set = async () => {
    throw Error("Storage full");
  };
  await assert.rejects(
    f.service.run(9, 1, { action: "close", token: p.token, ids: [2] }),
    /Storage full/,
  );
  assert.equal(f.removed.length, 0);
});
test("partial close failures preserve a restore session for the actual closed tabs", async () => {
  const f = fixture(),
    p = await f.preview(),
    remove = f.chrome.tabs.remove;
  f.chrome.tabs.remove = async (id) => {
    if (id === 4) throw Error("Tab is busy");
    return remove(id);
  };
  const result = await f.service.run(9, 1, {
    action: "close",
    token: p.token,
    ids: [2, 4],
  });
  assert.equal(result.closed, 1);
  assert.match(result.error, /busy/);
  await f.service.run(9, 1, { action: "restore" });
  assert.deepEqual(f.windows[0].url, ["chrome://newtab/"]);
});

test('expired previews and repeated in-flight clicks cannot close tabs',async()=>{
 const f=fixture(),p=await f.preview();
 f.state['tabbit.cleanup.9'].createdAt=1;
 await assert.rejects(f.service.run(9,1,{action:'close',token:p.token,ids:[2]}),/expired/);
 const next=f.preview();await assert.rejects(f.preview(),/already running/);await next;
 assert.equal(f.removed.length,0);
});
