#!/usr/bin/env node
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { serve } = require("./protocol");
const CLAUDE_BIN = process.env.TABBIT_CLAUDE_BIN || "claude";
const LIMIT = 1024 * 1024 - 4096;

function buildClaudeArgs(request) {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--tools",
    "",
    "--safe-mode",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--disable-slash-commands",
  ];
  if (
    typeof request.model === "string" &&
    /^[a-z0-9][\w.:-]{0,79}$/i.test(request.model)
  )
    args.push("--model", request.model);
  if (["low", "medium", "high"].includes(request.effort))
    args.push("--effort", request.effort);
  return args;
}

function subscriptionEnvironment(env = process.env) {
  const result = { ...env };
  // Do not accidentally bill an inherited API key or route to another provider.
  for (const key of Object.keys(result)) {
    if (
      /^(ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CODE_OAUTH_TOKEN|CLAUDECODE$)/.test(
        key,
      )
    )
      delete result[key];
  }
  return result;
}

function parseReply(stdout) {
  const reply = JSON.parse(stdout);
  if (reply.is_error)
    throw new Error(
      (reply.errors || []).join("; ") ||
        reply.result ||
        "Claude request failed",
    );
  const content = reply.structured_output
    ? JSON.stringify(reply.structured_output)
    : reply.result;
  if (typeof content !== "string" || !content.trim())
    throw new Error("Claude returned an empty response");
  if (Buffer.byteLength(content) > LIMIT)
    throw new Error("Claude reply was too large to return");
  return { ok: true, content };
}

function runClaude(
  request,
  {
    spawnImpl = spawn,
    claudeBin = CLAUDE_BIN,
    timeoutMs = 300000,
    onChild = () => {},
  } = {},
) {
  return new Promise((resolve) => {
    if (typeof request?.prompt !== "string" || !request.prompt.trim())
      return resolve({ ok: false, error: "Empty prompt" });
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tabbit-claude-"));
    let stdout = "",
      stderr = "",
      settled = false,
      timer,
      child;
    const finish = (reply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fs.rmSync(cwd, { recursive: true, force: true });
      resolve(reply);
    };
    try {
      child = spawnImpl(claudeBin, buildClaudeArgs(request), {
        cwd,
        env: subscriptionEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
      });
      onChild(child);
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish({ ok: false, error: "Claude took too long to answer" });
      }, timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > 2 * LIMIT) {
          child.kill("SIGTERM");
          finish({ ok: false, error: "Claude reply was too large to return" });
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-2000);
      });
      child.on("error", (error) =>
        finish({
          ok: false,
          error:
            error.code === "ENOENT"
              ? "Claude CLI not found. Run npm run install-claude-host."
              : error.message,
        }),
      );
      child.on("close", (code) => {
        if (settled) return;
        try {
          if (code !== 0)
            throw new Error(stderr.trim() || `Claude exited with code ${code}`);
          finish(parseReply(stdout));
        } catch (error) {
          finish({ ok: false, error: error.message });
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(request.prompt);
    } catch (error) {
      finish({ ok: false, error: error.message });
    }
  });
}
if (require.main === module) serve(runClaude, { claudeBin: CLAUDE_BIN });
module.exports = {
  buildClaudeArgs,
  subscriptionEnvironment,
  parseReply,
  runClaude,
};
