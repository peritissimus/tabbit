const test = require("node:test");
const assert = require("node:assert/strict");
const createJob = require("../src/build-lifecycle");
const timing = require("../src/build-timing");

test("single-flight job releases after rejection and starts a fresh attempt", async () => {
  const saved = {};
  const job = createJob({
    chrome: {
      storage: {
        local: { set: async (values) => Object.assign(saved, values) },
      },
    },
    timing,
    key: "build",
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let runs = 0;
  const work = async (attempt) => {
    runs++;
    await job.set({ status: "running", phase: "reading", attempt });
    await gate;
    throw new Error("read failed");
  };
  const first = job.start(work);
  assert.equal(job.start(work), first);
  assert.equal(job.running, true);
  release();
  await assert.rejects(first, /read failed/);
  assert.equal(runs, 1);
  assert.equal(job.running, false);
  await job.start(async (attempt) => {
    job.reset();
    await job.set({ status: "idle", phase: null, attempt });
  }, 2);
  assert.equal(saved.build.attempt, 2);
  assert.equal(saved.build.status, "idle");
});

test("independent jobs never share progress or pending requests", async () => {
  const saved = {};
  const dependencies = {
    chrome: {
      storage: {
        local: { set: async (values) => Object.assign(saved, values) },
      },
    },
    timing,
  };
  const brief = createJob({ ...dependencies, key: "brief" }),
    feed = createJob({ ...dependencies, key: "feed" });
  await Promise.all([
    brief.set({ status: "running", phase: "writing" }),
    feed.set({ status: "running", phase: "curating" }),
  ]);
  assert.equal(brief.state.phase, "writing");
  assert.equal(feed.state.phase, "curating");
  brief.reset();
  assert.equal(feed.state.phase, "curating");
});
