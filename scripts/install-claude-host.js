"use strict";
try {
  require("./install-codex-host").main("claude");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
