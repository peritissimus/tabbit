const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('../src/newtab-organization-view');
const {keys,messages} = require('../src/contracts');
function fixture(sendMessage, saved) {
  const handlers = {};
  const button = {setAttribute(){},addEventListener(type, fn){handlers[type]=fn;}};
  const status = {classList:{toggle(){}}};
  const chrome = {
    tabs:{getCurrent:async()=>({windowId:4})},
    runtime:{sendMessage},
    storage:{onChanged:{addListener(){}}, local:{get:async()=>({'tabbit.organization.4':saved})}},
  };
  const view = create({chrome,document:{querySelector:selector=>selector==='#organizeTabs'?button:status},keys,messages});
  return {view,handlers,button,status};
}
test('missing worker acknowledgment explains how to recover and allows retry',async()=>{
  const f=fixture(async message=>{assert.equal(message.type,messages.organizeTabs);});
  await f.view.bind();await f.handlers.click();
  assert.match(f.status.textContent,/chrome:\/\/extensions/);
  assert.match(f.status.textContent,/fresh new tab/);
  assert.equal(f.button.disabled,false);
});
test('lost connection gives recovery instructions, worker errors retain their actual cause',async()=>{
  for(const [error,expected] of [['Could not establish connection. Receiving end does not exist.',/reload Tabbit/],['Usage limit reached',/Usage limit reached/]]){
    const f=fixture(async()=>{throw Error(error);});
    await f.view.bind();await f.handlers.click();
    assert.match(f.status.textContent,expected);
  }
});
test('missing reply does not overwrite a job that actually completed',async()=>{
  const saved={status:'done',startedAt:Date.now()+1000,message:'A little tidier · 2 groups in this window'};
  const f=fixture(async()=>undefined,saved);
  await f.view.bind();await f.handlers.click();
  assert.equal(f.status.textContent,saved.message);
  assert.equal(f.button.disabled,false);
});
test('a stale previous result cannot hide a failed start',async()=>{
  const f=fixture(async()=>undefined,{status:'done',startedAt:1,message:'Old result'});
  await f.view.bind();await f.handlers.click();
  assert.match(f.status.textContent,/reload Tabbit/);
});
