#!/usr/bin/env node
// Chrome native messaging host: lets the Tabbit extension use a Codex
// subscription by running each request through the signed-in `codex` CLI.
// Installed by scripts/install-codex-host.js.
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CODEX_BIN = process.env.TABBIT_CODEX_BIN || "codex";
const RUN_TIMEOUT_MS = 5 * 60 * 1000;
// Chrome drops any host message over 1 MB.
const MAX_REPLY_BYTES = 1024 * 1024 - 4096;
const EFFORTS = new Set(["low", "medium", "high"]);
const MODEL_PATTERN = /^[a-z0-9][\w.:-]{0,79}$/i;

function buildCodexArgs(request, workDir, outputFile) {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    // The user's coding setup (AGENTS.md, MCP servers, rules) is irrelevant
    // here and costs tokens on every call.
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox", "read-only",
    "--color", "never",
    "--cd", workDir,
    "--output-last-message", outputFile
  ];

  if (typeof request.model === "string" && MODEL_PATTERN.test(request.model)) {
    args.push("--model", request.model);
  }

  if (EFFORTS.has(request.effort)) {
    args.push("--config", `model_reasoning_effort="${request.effort}"`);
  }

  // The prompt is read from stdin.
  args.push("-");
  return args;
}

function encodeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

// Native messages are a 4-byte little-endian length followed by UTF-8 JSON.
function createMessageReader(onMessage) {
  let buffer = Buffer.alloc(0);

  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);

      if (buffer.length < 4 + length) {
        return;
      }

      const body = buffer.subarray(4, 4 + length).toString("utf8");
      buffer = buffer.subarray(4 + length);
      onMessage(JSON.parse(body));
    }
  };
}

function lastLines(text, limit = 400) {
  const trimmed = String(text || "").trim();
  return trimmed.length > limit ? trimmed.slice(-limit) : trimmed;
}

function runCodex(request, { spawnImpl = spawn, codexBin = CODEX_BIN, timeoutMs = RUN_TIMEOUT_MS, onChild = () => {} } = {}) {
  return new Promise((resolve) => {
    if (typeof request.prompt !== "string" || !request.prompt.trim()) {
      resolve({ ok: false, error: "Empty prompt" });
      return;
    }

    // An empty directory, so the agent has no project files to look at.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabbit-codex-"));
    const outputFile = path.join(workDir, "reply.txt");
    let stderr = "";
    let settled = false;

    const finish = (reply) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      fs.rmSync(workDir, { recursive: true, force: true });
      resolve(reply);
    };

    const child = spawnImpl(codexBin, buildCodexArgs(request, workDir, outputFile), {
      cwd: workDir,
      stdio: ["pipe", "ignore", "pipe"]
    });
    onChild(child);

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, error: "Codex took too long to answer" });
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });

    child.on("error", (error) => {
      finish({ ok: false, error: error.code === "ENOENT" ? `Codex CLI not found at ${codexBin}. Re-run npm run install-codex-host.` : error.message });
    });

    child.on("close", (code) => {
      let content = "";

      try {
        content = fs.readFileSync(outputFile, "utf8");
      } catch (_error) {
        // No reply was written.
      }

      if (code !== 0 || !content.trim()) {
        finish({ ok: false, error: lastLines(stderr) || `Codex exited with code ${code}` });
      } else if (Buffer.byteLength(content) > MAX_REPLY_BYTES) {
        finish({ ok: false, error: "Codex reply was too large to return" });
      } else {
        finish({ ok: true, content });
      }
    });

    child.stdin.on("error", () => {});
    child.stdin.end(request.prompt);
  });
}

function main() {
  const children = new Set();
  let pending = 0;
  let closed = false;

  const send = (value) => process.stdout.write(encodeMessage(value));
  const exitWhenIdle = () => {
    if (closed && pending === 0) {
      process.exit(0);
    }
  };

  const read = createMessageReader(async (request) => {
    if (request?.type === "ping") {
      send({ ok: true, codexBin: CODEX_BIN });
      return;
    }

    pending += 1;
    const reply = await runCodex(request, {
      onChild: (child) => {
        children.add(child);
        child.on("close", () => children.delete(child));
      }
    });
    pending -= 1;

    if (!closed) {
      send(reply);
    }

    exitWhenIdle();
  });

  process.stdin.on("data", (chunk) => {
    try {
      read(chunk);
    } catch (error) {
      send({ ok: false, error: `Bad message: ${error.message}` });
    }
  });

  // Chrome closes stdin when the extension disconnects: stop any run in flight.
  process.stdin.on("end", () => {
    closed = true;
    children.forEach((child) => child.kill("SIGTERM"));
    exitWhenIdle();
  });
}

if (require.main === module) {
  main();
}

module.exports = { buildCodexArgs, createMessageReader, encodeMessage, runCodex };
