const test = require('node:test');
const assert = require('node:assert/strict');
const {update, describe} = require('../src/build-timing');
test('records phase wall time without resetting on progress updates', () => {
  let state = update(null,{status:'running',phase:'choosing',startedAt:1000,attempt:1},1000);
  state=update(state,{phase:'reading'},4000);
  state=update(state,{scrapeWindowId:42},6000);
  state=update(state,{phase:'curating'},11000);
  state=update(state,{status:'idle',phase:null,finishedAt:16000},16000);
  assert.deepEqual(state.timings,{choosing:3000,reading:7000,curating:5000});
  assert.equal(state.durationMs,15000);
  assert.equal(describe(state).summary,'Built in 15.0s');
  assert.match(describe(state).detail,/Longest stage: Source reading/);
});
test('failed attempts retain elapsed time and old builds have no invented timing', () => {
  const start=update(null,{status:'running',phase:'writing',startedAt:1000},1000);
  const failed=update(start,{status:'failed',phase:null,finishedAt:4000},4000);
  assert.equal(describe(failed).summary,'Failed after 3.0s');
  assert.equal(describe({status:'idle',finishedAt:4000}),null);
  const retry=update(null,{status:'running',phase:'history',startedAt:5000,attempt:2},5000);
  assert.deepEqual(retry.timings,{});
});
