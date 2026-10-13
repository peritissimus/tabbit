const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { buildCodexArgs, createMessageReader, encodeMessage, runCodex } = require("../native-host/codex-host");
const { unpackedExtensionId } = require("../scripts/install-codex-host");

// Stands in for the codex CLI: echoes its model and stdin into the reply file.
const FAKE_CODEX = `
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
let prompt = "";
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", () => {
  if (prompt.includes("fail")) { console.error("usage limit reached"); process.exit(1); }
  require("node:fs").writeFileSync(value("--output-last-message"), JSON.stringify({ model: value("--model"), prompt, cwd: process.cwd() }));
});
`;

function fakeCodex() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tabbit-test-")), "codex.js");
  fs.writeFileSync(file, FAKE_CODEX);
  return { spawnImpl: (_bin, args, options) => spawn(process.execPath, [file, ...args], options) };
}

test("reads framed messages split across chunks", () => {
  const seen = [];
  const read = createMessageReader((message) => seen.push(message));
  const bytes = Buffer.concat([encodeMessage({ type: "ping" }), encodeMessage({ prompt: "héllo" })]);
  read(bytes.subarray(0, 7));
  read(bytes.subarray(7));
  assert.deepEqual(seen, [{ type: "ping" }, { prompt: "héllo" }]);
});

test("runs codex read-only without user config and drops unsafe options", () => {
  const args = buildCodexArgs({ model: "gpt-6-luna", effort: "low" }, "/work", "/work/reply.txt");
  assert.deepEqual(args.slice(0, 5), ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules"]);
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.equal(args[args.indexOf("--model") + 1], "gpt-6-luna");
  assert.equal(args[args.indexOf("--config") + 1], 'model_reasoning_effort="low"');
  assert.equal(args.at(-1), "-");

  const unsafe = buildCodexArgs({ model: "--dangerously-bypass-approvals-and-sandbox", effort: 'low"\nx' }, "/work", "/work/reply.txt");
  assert.equal(unsafe.includes("--model"), false);
  assert.equal(unsafe.includes("--config"), false);
});

test("returns the final codex message and cleans up its empty work directory", async () => {
  const reply = await runCodex({ prompt: "Return JSON", model: "gpt-6-luna", effort: "low" }, fakeCodex());
  assert.equal(reply.ok, true);
  const content = JSON.parse(reply.content);
  assert.equal(content.model, "gpt-6-luna");
  assert.equal(content.prompt, "Return JSON");
  assert.equal(fs.existsSync(content.cwd), false);
});

test("reports codex failures and empty prompts", async () => {
  const failed = await runCodex({ prompt: "please fail" }, fakeCodex());
  assert.deepEqual(failed, { ok: false, error: "usage limit reached" });
  assert.equal((await runCodex({ prompt: " " }, fakeCodex())).ok, false);
  const missing = await runCodex({ prompt: "hi" }, { codexBin: "/nonexistent/codex" });
  assert.match(missing.error, /Codex CLI not found/);
});

test("derives the unpacked extension id Chrome assigns to a folder", () => {
  assert.equal(unpackedExtensionId("/Users/peritissimus/projects/tabbit"), "ahnoajeldokkgcjlgecgbmdimahogeok");
});
