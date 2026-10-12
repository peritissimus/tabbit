const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function harness() {
  const storage={'tabbit.aiSettings':{apiKey:'dummy',modelRoutingVersion:1}};
  const requests=[], updates=[];
  const listener={addListener(){}};
  const context=vm.createContext({URL,AbortSignal,TextDecoderStream,setTimeout,clearTimeout,setInterval,clearInterval,console,
    chrome:{storage:{local:{get:async key=>({[key]:storage[key]}),set:async values=>{Object.assign(storage,values);updates.push(structuredClone(values));}}},
      runtime:{onMessage:listener,onStartup:listener,onInstalled:listener,getPlatformInfo(){}},
      alarms:{onAlarm:listener,create:async()=>{},clear:async()=>{}},
      tabs:{query:async()=>[]},history:{search:async()=>[{url:'https://react.dev/',title:'React UI',visitCount:10,lastVisitTime:Date.now()}]},
      windows:{remove:async()=>{}}},
    fetch:async(url,options)=>{
      if(String(url).includes('firebaseio')) {
        if(String(url).includes('stories')) return Response.json([String(url).includes('show')?2:1]);
        const product=String(url).includes('/2.json');
        return Response.json({type:'story',id:product?2:1,title:product?'Show HN: New developer tool':'New framework release',url:product?'https://tool.example/':'https://framework.example/',time:Math.floor(Date.now()/1000),score:120,descendants:10});
      }
      const body=JSON.parse(options.body);requests.push(body);
      const payload=body.model==='gpt-6-luna'?{sourceIds:[3]}:{items:[
        {itemId:1,title:'Framework update',kind:'news',summary:'New release',reason:'Relevant to frontend work',topics:['frontend']},
        {itemId:2,title:'Developer tool',kind:'product',summary:'New tool',reason:'Matches coding workflow',topics:['developer tools']},
        {itemId:999,title:'Invented',kind:'product'}]};
      return new Response(`data: ${JSON.stringify({choices:[{delta:{content:JSON.stringify(payload)}}]})}\n\ndata: [DONE]\n\n`);
    }});
  context.self=context;
  context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),context));
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/background.js'),'utf8'),context);
  vm.runInContext('readPages = async targets => targets.map(item=>({item,ok:false,error:"Source unavailable"}))',context);
  return {storage,requests,updates,context,run:code=>vm.runInContext(code,context)};
}
test('worker persists a single feed build, uses real community evidence and reports unavailable sources',async()=>{
  const h=harness();
  await h.run('Promise.all([startFeed(), startFeed()])');
  assert.deepEqual(h.requests.map(r=>r.model),['gpt-6-luna','gpt-6.1-sol']);
  assert.deepEqual(Array.from(h.storage['tabbit.feed'].items,i=>i.url),['https://framework.example/','https://tool.example/']);
  assert.equal(h.storage['tabbit.feed'].items[0].score,120);
  assert.equal(h.storage['tabbit.feed'].sources.find(s=>s.title==='Product Hunt').ok,false);
  assert.equal(h.storage['tabbit.feedBuild'].status,'idle');
  assert.deepEqual(h.updates.filter(v=>v['tabbit.feedBuild']).map(v=>v['tabbit.feedBuild'].phase),['choosing','reading','curating',null]);
  await h.run('tickDiscovery()');assert.equal(h.requests.length,2,'reopening a fresh edition makes no AI request');
});
test('feedback writes serialize and influence the next source selection and edition',async()=>{
  const h=harness();await h.run('startFeed()');
  await h.run(`Promise.all([updateFeedPreference({type:"tabbit.feedFeedback",url:"https://tool.example/",vote:1}),updateFeedPreference({type:"tabbit.feedFeedback",url:"https://tool.example/",vote:-1})])`);
  assert.equal(Object.values(h.storage['tabbit.feedFeedback'])[0].vote,-1);
  await h.run('startFeed()');
  assert.equal(h.storage['tabbit.feed'].items.length,1);
  assert.equal(JSON.parse(h.requests[2].messages[1].content).feedback[0].vote,-1);
  await assert.rejects(h.run('updateFeedPreference({type:"tabbit.feedFeedback",url:"https://unknown.example/",vote:1})'));
});
test('failed builds retain the old edition and stale failed attempts back off',async()=>{
  const h=harness();await h.run('startFeed()');
  const old=h.storage['tabbit.feed'];delete h.storage['tabbit.aiSettings'].apiKey;
  await h.run('startFeed()');
  assert.equal(h.storage['tabbit.feed'],old);
  assert.equal(h.storage['tabbit.feedBuild'].status,'failed');
  old.createdAt=Date.now()-8*3600000;
  await h.run('tickDiscovery()');assert.equal(h.requests.length,2);
});
test('stopped builds report bounded interruption and auto-refresh respects preferences',async()=>{
  const h=harness();
  h.storage['tabbit.feedBuild']={status:'running',attempt:2};
  await h.run('tickDiscovery()');
  assert.equal(h.storage['tabbit.feedBuild'].status,'failed');
  h.storage['tabbit.feed']={createdAt:1,items:[]};
  h.storage['tabbit.feedBuild']={status:'idle',finishedAt:1};
  h.storage['tabbit.feedPreferences']={autoRefresh:false};
  await h.run('tickDiscovery()');assert.equal(h.requests.length,0);
});
test('source reads reject cross-host redirects and challenge pages before sending content',async()=>{
  const h=harness();
  h.context.chrome.scripting={executeScript:async()=>[{result:{url:'https://login.other.example/',title:'Login',text:'Private'.repeat(30),links:[]}}]};
  const redirected=await h.run('readTab(1,{url:"https://www.producthunt.com/",discovery:true})');
  assert.equal(redirected.ok,false);
  h.context.chrome.scripting.executeScript=async()=>[{result:{url:'https://www.producthunt.com/',title:'Just a moment...',text:'Verify you are human'.repeat(10),links:[]}}];
  const blocked=await h.run('readTab(1,{url:"https://www.producthunt.com/",discovery:true})');
  assert.equal(blocked.ok,false);
});
