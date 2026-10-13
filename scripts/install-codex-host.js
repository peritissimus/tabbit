#!/usr/bin/env node
// Registers native-host/codex-host.js with Chrome so the extension can reach
// the local Codex CLI. Usage:
//   node scripts/install-codex-host.js [--id <extension id>] [--codex <path>] [--uninstall]
"use strict";

const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let provider = "codex";
let HOST_NAME, HOST_SCRIPT, LAUNCHER;
const ROOT = path.resolve(__dirname, "..");



// Chrome derives an unpacked extension's id from the folder it was loaded from.
function unpackedExtensionId(extensionPath) {
  return crypto.createHash("sha256").update(extensionPath).digest("hex").slice(0, 32)
    .replace(/./g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
}

function hostDirectories() {
  const home = os.homedir();

  if (process.platform === "darwin") {
    const support = path.join(home, "Library", "Application Support");
    return ["Google/Chrome", "Google/Chrome Canary", "Chromium"].map((browser) => path.join(support, browser));
  }

  if (process.platform === "linux") {
    return [".config/google-chrome", ".config/google-chrome-unstable", ".config/chromium"].map((browser) => path.join(home, browser));
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function findCodex() {
  const given = argument(`--${provider}`);

  if (given) {
    return path.resolve(given);
  }

  try {
    return execFileSync("which", [provider], { encoding: "utf8" }).trim();
  } catch (_error) {
    throw new Error(`Could not find ${provider} on PATH. Install it or pass --${provider} <path>.`);
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function main(selectedProvider = "codex") {
  provider = selectedProvider;
  HOST_NAME = `dev.tabbit.${provider}`;
  HOST_SCRIPT = path.join(ROOT, "native-host", `${provider}-host.js`);
  LAUNCHER = path.join(ROOT, "native-host", provider === "codex" ? "run-host.sh" : "run-claude-host.sh");
  const browsers = hostDirectories().filter((directory) => fs.existsSync(directory));
  const manifests = browsers.map((directory) => path.join(directory, "NativeMessagingHosts", `${HOST_NAME}.json`));

  if (process.argv.includes("--uninstall")) {
    [...manifests, LAUNCHER].forEach((file) => fs.rmSync(file, { force: true }));
    console.log(`Removed the Tabbit ${provider} host.`);
    return;
  }

  if (!browsers.length) {
    throw new Error("No Chrome profile directory found.");
  }

  const extensionId = argument("--id") || unpackedExtensionId(ROOT);
  const codex = findCodex();

  // Chrome starts hosts with a bare PATH, so node and codex are pinned here.
  // codex is itself a node script, hence node's directory on PATH.
  fs.writeFileSync(LAUNCHER, [
    "#!/bin/sh",
    `export PATH=${shellQuote(path.dirname(process.execPath))}:"$PATH"`,
    `export TABBIT_${provider.toUpperCase()}_BIN=${shellQuote(codex)}`,
    `exec ${shellQuote(process.execPath)} ${shellQuote(HOST_SCRIPT)} "$@"`,
    ""
  ].join("\n"), { mode: 0o755 });

  const manifest = JSON.stringify({
    name: HOST_NAME,
    description: `Tabbit bridge to the local ${provider} CLI`,
    path: LAUNCHER,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  }, null, 2);

  for (const file of manifests) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${manifest}\n`);
    console.log(`Installed ${file}`);
  }

  console.log(`Extension id: ${extensionId}`);
  console.log(`${provider} CLI:    ${codex}`);
  console.log(`Reload Tabbit in chrome://extensions, then choose ${provider} subscription in Settings.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { unpackedExtensionId, main };
