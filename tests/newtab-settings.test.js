const assert = require("node:assert/strict");
const test = require("node:test");
const { DEFAULT_SHORTCUTS, readShortcuts, validateShortcuts } = require("../src/newtab-settings");

test("keeps the requested AWS and Mononest destinations first without Drive", () => {
  const defaults = readShortcuts(undefined);
  assert.equal(defaults[0].url, "https://d-9067d10406.awsapps.com/start/#/");
  assert.equal(defaults[1].url, "https://github.com/zoca-ai/mononest");
  assert.ok(defaults.every((item) => !item.url.includes("drive.google.com")));
  defaults[0].label = "Changed";
  assert.equal(DEFAULT_SHORTCUTS[0].label, "AWS");
});

test("preserves user ordering, edited names, explicit removals and an empty row", () => {
  const saved = [{ label: " Repo ", url: "https://github.com/zoca-ai/mononest" }, { label: "Local", url: "http://localhost:3000/" }];
  assert.deepEqual(readShortcuts(saved), [{ ...saved[0], label: "Repo" }, saved[1]]);
  assert.deepEqual(readShortcuts([]), []);
});

test("rejects unsafe URLs, missing names, duplicate destinations and excessive shortcuts", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/a", "https://user:pass@example.com", "example.com"]) {
    assert.throws(() => validateShortcuts([{ label: "Example", url }]));
  }
  assert.throws(() => validateShortcuts([{ label: " ", url: "https://example.com" }]));
  assert.throws(() => validateShortcuts([{ label: "a".repeat(33), url: "https://example.com" }]));
  assert.throws(() => validateShortcuts([{ label: "One", url: "https://example.com" }, { label: "Two", url: "https://example.com/" }]));
  assert.throws(() => validateShortcuts(Array(9).fill({ label: "A", url: "https://example.com" })));
  assert.deepEqual(readShortcuts({ corrupt: true }), DEFAULT_SHORTCUTS);
});
