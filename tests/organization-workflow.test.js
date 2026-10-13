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

test('AI omissions and local singletons still receive groups', async () => {
  for (const settings of [{}, {provider:'claude'}]) {
    const f=fixture(settings);
    f.tabs.push({id:4,windowId:4,index:4,url:'https://unique.example/path',title:'Unique'});
    f.deps.grouping.run=async()=>({status:'done',groups:[{title:'Code',tabIds:[1]}]});
    await create(f.deps).run(4);
    assert.deepEqual(f.calls.flatMap(call=>call.tabIds).sort(),[1,2,4]);
    assert.equal(f.saved['tabbit.organization.4'].groupedTabs,3);
  }
});
test('new-tab cleanup keeps initiating tab, protects pins, other extensions and pending navigation',async()=>{
  const f=fixture();
  const own='chrome-extension://tabbit/src/newtab.html';
  f.deps.chrome.runtime={getURL:()=>own};
  const extra=[
    {id:10,url:own}, {id:11,url:'chrome://newtab/'},
    {id:12,url:own,pinned:true},
    {id:13,url:'chrome-extension://other/src/newtab.html'},
    {id:14,url:'chrome://newtab/',pendingUrl:'https://example.com/'},
    {id:15,url:'chrome://newtab/'},
    {id:16,url:'chrome://new-tab-page/',active:true},
  ].map(t=>({windowId:4,...t}));
  f.tabs.push(...extra);
  const removed=[];
  f.deps.chrome.tabs.get=async id=>id===15 ? {...extra.find(t=>t.id===id),url:'https://navigated.example/'} : extra.find(t=>t.id===id);
  f.deps.chrome.tabs.remove=async id=>removed.push(id);
  await create(f.deps).run(4,10);
  assert.deepEqual(removed,[11,16]);
  assert.equal(f.saved['tabbit.organization.4'].closedNewTabs,2);
  assert.match(f.saved['tabbit.organization.4'].message,/2 extra new tabs closed/);
});
test('new-tab cleanup rechecks window and tolerates already closed tabs',async()=>{
  const f=fixture();
  f.tabs.push(...[10,11,12].map(id=>({id,windowId:4,url:'chrome://newtab/'})));
  f.deps.chrome.tabs.get=async id=>{
    if(id===11)throw Error('No tab');
    return {id,windowId:9,url:'chrome://newtab/'};
  };
  f.deps.chrome.tabs.remove=async()=>assert.fail('must not remove moved tab');
  await create(f.deps).run(4,10);
  assert.equal(f.saved['tabbit.organization.4'].status,'done');
  assert.equal(f.saved['tabbit.organization.4'].closedNewTabs,0);
});
