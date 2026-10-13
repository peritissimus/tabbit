const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("worker migrates saved settings and routes actual grouping, selection and brief requests", async () => {
  const storage = { "tabbit.aiSettings": { apiKey: "dummy-key", model: "gpt-5.4-nano", context: "Test" } };
  const requests = [];
  const listener = { addListener() {} };
  const context = vm.createContext({
    URL, TextDecoderStream, setTimeout, clearTimeout, setInterval, clearInterval, console,
    chrome: {
      storage: { local: {
        get: async (key) => ({ [key]: storage[key] }),
        set: async (values) => Object.assign(storage, values)
      } },
      runtime: { onMessage: listener, onStartup: listener, onInstalled: listener, getPlatformInfo() {} },
      alarms: { onAlarm: listener, create: async () => {}, clear: async () => {} },
      tabs: { query: async () => [] },
      history: { search: async () => [] }
    },
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      const payload = body.stream
        ? (body.model === "gpt-6-luna" ? { pageIds: [] } : { headline: "Test brief", threads: [], attention: [] })
        : { groups: [] };
      if (!body.stream) return Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(payload) } }] })}\n\ndata: [DONE]\n\n`);
    }
  });
  context.self = context;
  context.importScripts = (...files) => files.forEach((file) => vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), context));
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8"), context);
  await vm.runInContext('grouping.run({ requestBody: { model: "stale-model", messages: [] }, tabIds: [], windowId: 1 })', context);
  await vm.runInContext("brief.start(1)", context);
  assert.deepEqual(requests.map((body) => body.model), ["gpt-6-luna", "gpt-6-luna", "gpt-6.1-sol"]);
  assert.deepEqual(requests.map((body) => body.reasoning_effort), ["low", "low", "medium"]);
  assert.equal(storage["tabbit.plan"].status, "done");
  assert.equal(storage["tabbit.build"].status, "idle");
  assert.equal(storage["tabbit.brief"].model, "gpt-6.1-sol");
  assert.equal(storage["tabbit.brief"].selectionModel, "gpt-6-luna");
  assert.equal(storage["tabbit.aiSettings"].apiKey, "dummy-key");
  assert.equal(storage["tabbit.aiSettings"].modelRoutingVersion, 1);
});
