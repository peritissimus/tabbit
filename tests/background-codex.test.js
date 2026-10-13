const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadWorker(storage, connectNative) {
  const listener = { addListener() {} };
  const context = vm.createContext({
    URL,
    TextDecoderStream,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    chrome: {
      storage: {
        local: {
          get: async (key) => ({ [key]: storage[key] }),
          set: async (values) => Object.assign(storage, values),
        },
      },
      runtime: {
        onMessage: listener,
        onStartup: listener,
        onInstalled: listener,
        getPlatformInfo() {},
        connectNative,
      },
      alarms: {
        onAlarm: listener,
        create: async () => {},
        clear: async () => {},
      },
      tabs: { query: async () => [] },
      history: { search: async () => [] },
    },
    fetch: async () => {
      throw new Error("Codex mode must not call the OpenAI API");
    },
  });
  context.self = context;
  context.importScripts = (...files) =>
    files.forEach((file) =>
      vm.runInContext(
        fs.readFileSync(path.join(__dirname, "../src", file), "utf8"),
        context,
      ),
    );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8"),
    context,
  );
  return context;
}

for (const provider of ["codex", "claude"]) {
  test("worker sends grouping, selection and brief requests to the Codex host without a key", async () => {
    const storage = {
      "tabbit.aiSettings": {
        provider,
        modelRoutingVersion: 1,
        model: "gpt-6-luna",
        briefModel: "gpt-6.1-sol",
      },
    };
    const requests = [];
    const replies = [
      '```json\n{"groups":[]}\n```',
      '{"pageIds":[]}',
      '{"headline":"Test brief","threads":[],"attention":[]}',
    ];
    const context = loadWorker(storage, (host) => {
      let onMessage;
      return {
        onMessage: {
          addListener: (fn) => {
            onMessage = fn;
          },
        },
        onDisconnect: { addListener() {} },
        disconnect() {},
        postMessage(request) {
          requests.push({ host, ...request });
          setTimeout(() =>
            onMessage({ ok: true, content: replies[requests.length - 1] }),
          );
        },
      };
    });

    await vm.runInContext(
      'grouping.run({ requestBody: { messages: [{ role: "user", content: "tabs" }] }, tabIds: [], windowId: 1 })',
      context,
    );
    await vm.runInContext("brief.start(1)", context);
    assert.deepEqual(
      requests.map((request) => request.host),
      Array(3).fill(`dev.tabbit.${provider}`),
    );
    assert.deepEqual(
      requests.map((request) => request.model),
      provider === "claude"
        ? ["sonnet", "sonnet", "opus"]
        : ["gpt-6-luna", "gpt-6-luna", "gpt-6.1-sol"],
    );
    assert.deepEqual(
      requests.map((request) => request.effort),
      ["low", "low", "medium"],
    );
    assert.match(requests[0].prompt, /<user>\ntabs\n<\/user>$/);
    assert.equal(storage["tabbit.plan"].status, "done");
    assert.equal(storage["tabbit.build"].status, "idle");
    assert.equal(storage["tabbit.brief"].headline, "Test brief");
  });

  test("worker explains how to install the bridge when the host is missing", async () => {
    const storage = {
      "tabbit.aiSettings": { provider, modelRoutingVersion: 1 },
    };
    const context = loadWorker(storage, () => {
      const port = {
        onMessage: { addListener() {} },
        onDisconnect: {
          addListener: (fn) => {
            port.fail = fn;
          },
        },
        disconnect() {},
        postMessage() {
          context.chrome.runtime.lastError = {
            message: "Specified native messaging host not found.",
          };
          setTimeout(port.fail);
        },
      };
      return port;
    });

    const plan = await vm.runInContext(
      "grouping.run({ requestBody: { messages: [] }, tabIds: [], windowId: 1 })",
      context,
    );
    assert.equal(plan.status, "failed");
    assert.match(plan.error, new RegExp(`npm run install-${provider}-host`));
  });

  test("a failed native send releases its port immediately", async () => {
    let disconnected = false;
    const context = loadWorker({}, () => ({
      onMessage: { addListener() {} },
      onDisconnect: { addListener() {} },
      disconnect() {
        disconnected = true;
      },
      postMessage() {
        throw new Error("Port disconnected before send");
      },
    }));
    await assert.rejects(
      vm.runInContext(
        `ai.requestNativeJson([], {provider:"${provider}"}, "brief", 100)`,
        context,
      ),
      /Port disconnected/,
    );
    assert.equal(disconnected, true);
  });

  for (const kind of ["brief", "feed"]) {
    test(`${kind} Codex build survives repeated wake messages and persists one result`, async () => {
      const storage = {
        "tabbit.aiSettings": { provider, modelRoutingVersion: 1 },
      };
      const requests = [];
      const context = loadWorker(storage, () => {
        let reply;
        const port = {
          closed: false,
          onMessage: {
            addListener(fn) {
              reply = fn;
            },
          },
          onDisconnect: { addListener() {} },
          disconnect() {
            port.closed = true;
          },
          postMessage(request) {
            requests.push({
              request,
              port,
              reply: (value) =>
                reply({ ok: true, content: JSON.stringify(value) }),
            });
          },
        };
        return port;
      });
      context.chrome.alarms.get = async () => ({ name: "tabbit.tick" });
      context.chrome.windows = { remove: async () => {} };
      // Browser reads are fixtures; the worker and native transport lifecycle are real code.
      vm.runInContext(
        `reader.readPages = async targets => targets.map(item => ({item,ok:true,text:"Release is available",links:[{title:"New release",url:"https://example.com/release"}]}));
      communityReader.fetchHnSource = async item => ({item,ok:true,text:"New release",links:[{title:"New release",url:"https://example.com/release"}]});`,
        context,
      );
      const run = (code) => vm.runInContext(code, context);
      const waitFor = async (predicate) => {
        for (let i = 0; i < 100; i++) {
          if (predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        assert.fail("Worker did not reach expected phase");
      };
      const start = kind === "brief" ? "brief.start()" : "feed.start()";
      const stateKey = kind === "brief" ? "tabbit.build" : "tabbit.feedBuild";
      const resultKey = kind === "brief" ? "tabbit.brief" : "tabbit.feed";
      const pending = run(start);
      await waitFor(() => requests.length === 1);
      const startedAt = storage[stateKey].startedAt;
      // This is the wake operation sent when a new-tab view is opened again.
      await run("Promise.all([tick(),tick()])");
      assert.equal(requests.length, 1);
      assert.equal(requests[0].port.closed, false);
      assert.equal(storage[stateKey].startedAt, startedAt);
      requests[0].reply(kind === "brief" ? { pageIds: [] } : { sourceIds: [] });
      await waitFor(() => requests.length === 2);
      await run("tick()");
      assert.equal(requests.length, 2);
      assert.equal(requests[1].port.closed, false);
      requests[1].reply(
        kind === "brief"
          ? { headline: "Completed brief", threads: [], attention: [] }
          : {
              items: [
                {
                  itemId: 1,
                  title: "New release",
                  kind: "product",
                  summary: "Now available",
                  reason: "Useful for work",
                },
              ],
            },
      );
      await pending;
      assert.equal(storage[stateKey].status, "idle");
      assert.equal(storage[stateKey].attempt, 1);
      assert.ok(storage[resultKey].createdAt);
      if (kind === "feed") assert.equal(storage[resultKey].items.length, 1);
      const saved = storage[resultKey];
      await run("tick()");
      assert.equal(requests.length, 2);
      assert.equal(storage[resultKey], saved);
      assert.ok(requests.every((r) => r.port.closed));
    });
  }
}
