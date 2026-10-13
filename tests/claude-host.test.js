const assert = require("node:assert/strict");
const test = require("node:test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const {
  buildClaudeArgs,
  subscriptionEnvironment,
  parseReply,
  runClaude,
} = require("../native-host/claude-host");
const config = require("../src/ai-config");
test("Claude models remain separate across provider switches", () => {
  let settings = config.normalizeAiSettings({
    provider: "claude",
    apiKey: "saved",
    modelRoutingVersion: 1,
    model: "gpt-custom",
  });
  assert.equal(config.hasAiAccess(settings), true);
  settings = config.withProviderModels(
    settings,
    "sonnet-custom",
    "opus-custom",
  );
  assert.deepEqual(config.modelsForProvider(settings), {
    model: "sonnet-custom",
    briefModel: "opus-custom",
  });
  settings.provider = "codex";
  assert.equal(config.modelsForProvider(settings).model, "gpt-custom");
  assert.equal(settings.apiKey, "saved");
  assert.equal(settings.claudeBriefModel, "opus-custom");
});
test("Claude disables tools/customizations and inherited API billing", () => {
  const args = buildClaudeArgs({ model: "sonnet", effort: "low" });
  assert.equal(args[args.indexOf("--tools") + 1], "");
  for (const flag of [
    "--safe-mode",
    "--strict-mcp-config",
    "--no-session-persistence",
  ])
    assert.ok(args.includes(flag));
  assert.ok(
    !buildClaudeArgs({ model: "--bad", effort: "bad" }).includes("--model"),
  );
  assert.deepEqual(
    subscriptionEnvironment({
      HOME: "/home/user",
      PATH: "/bin",
      ANTHROPIC_API_KEY: "secret",
      ANTHROPIC_BASE_URL: "other",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDECODE: "1",
    }),
    { HOME: "/home/user", PATH: "/bin" },
  );
});
test("Claude result envelopes surface errors, empty responses and oversized output", () => {
  assert.deepEqual(parseReply('{"result":"{\\"ok\\":true}"}'), {
    ok: true,
    content: '{"ok":true}',
  });
  assert.throws(
    () => parseReply('{"is_error":true,"result":"Usage limit reached"}'),
    /Usage limit/,
  );
  assert.throws(() => parseReply("{}"), /empty/);
  assert.throws(
    () => parseReply(JSON.stringify({ result: "x".repeat(1048576) })),
    /too large/,
  );
});
test("Claude runner sends stdin, cleans up, handles missing CLI and timeout", async () => {
  const fake = (_bin, args, options) =>
    spawn(
      process.execPath,
      [
        "-e",
        `let text='';process.stdin.on('data',x=>text+=x);process.stdin.on('end',()=>console.log(JSON.stringify({result:JSON.stringify({text,cwd:process.cwd()})})));`,
      ],
      options,
    );
  const result = await runClaude({ prompt: "synthetic" }, { spawnImpl: fake });
  assert.equal(result.ok, true);
  const value = JSON.parse(result.content);
  assert.equal(value.text, "synthetic");
  assert.equal(fs.existsSync(value.cwd), false);
  assert.match(
    (await runClaude({ prompt: "x" }, { claudeBin: "/missing/claude" })).error,
    /CLI not found/,
  );
  const slow = (_bin, args, opts) =>
    spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], opts);
  assert.match(
    (await runClaude({ prompt: "x" }, { spawnImpl: slow, timeoutMs: 30 }))
      .error,
    /too long/,
  );
});
