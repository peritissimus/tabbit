const test = require('node:test');
const assert = require('node:assert/strict');
const { publicUrl,browsingProfile,sourceCandidates,selectSources,buildEvidence,buildFeed,applyFeedback,feedbackExamples } = require('../src/discovery');
const NOW=Date.now();
test('discovery profile excludes private, internal, authentication and unsupported browsing',()=>{
  const make=(url,title='Test')=>({url,title,visitCount:4,lastVisitTime:NOW});
  const result=browsingProfile([
    make('https://github.com/acme/project','Coding agents'),make('https://react.dev/learn','React'),
    make('https://grafana.acme.dev/','Private alert'),make('https://mail.google.com/','Mail'),
    make('http://127.0.0.1:4000/'),make('https://mybank.com/'),make('https://github.com/login'),
    make('https://github.com/?access_token=secret'),make('https://private.example.com/','Private title')
  ],'*.acme.dev',NOW);
  assert.deepEqual(result.map(r=>r.host),['github.com','react.dev']);
  assert.equal(result[0].titles[0],'Coding agents');
  for(const url of ['javascript:alert(1)','http://127.1/','https://user:pass@example.com','http://[::1]/','http://app.internal/','http://169.254.169.254/']) assert.equal(publicUrl(url),null,url);
});
test('source selection accepts known IDs, caps fourteen and preserves community discovery',()=>{
  const candidates=sourceCandidates([{host:'simonwillison.net',visits:20}]);
  assert.equal(candidates[0].title,'Simon Willison');
  const selected=selectSources([999,...candidates.map(s=>s.id)],candidates);
  assert.equal(selected.length,14);
  assert.deepEqual(selected.slice(0,2).map(s=>s.title),['Hacker News','Show HN']);
  assert.equal(selectSources(null,candidates).length,13);
  for (const lab of ['OpenAI','Anthropic','Google DeepMind','Meta AI','xAI','Mistral']) assert.ok(selected.some(s=>s.lab===lab));
});
test('evidence keeps actual public links with observed dates/traction, deduplicates them',()=>{
  const evidence=buildEvidence([{ok:true,item:{title:'HN',url:'https://news.ycombinator.com/'},text:'Current stories',links:[
    {title:'Tool A',url:'https://tool.example/a',score:100,publishedAt:new Date(NOW).toISOString()},
    {title:'Tool A again',url:'https://tool.example/a#top'},
    {title:'Private',url:'http://10.0.0.1/'},{title:'Mail',url:'mailto:a@example.com'}
  ]}]);
  assert.equal(evidence.items.length,1);assert.equal(evidence.items[0].score,100);
  assert.equal(evidence.pages[0].links[0].id,evidence.pages[0].links[1].id);
});
test('feed rejects invented IDs, duplicates, unsupported kinds, stale dated items and disliked links',()=>{
  const items=[{id:1,url:'https://a.example/',title:'A',source:'HN',publishedAt:new Date(NOW).toISOString()},
    {id:2,url:'https://b.example/',title:'B',source:'HN',publishedAt:new Date(NOW-30*86400000).toISOString()},
    {id:3,url:'https://c.example/',title:'C',source:'PH',publishedAt:null}];
  const payload={items:[{itemId:99,title:'Invented',kind:'news'},{itemId:1,title:'A',kind:'news',score:99999,publishedAt:'2020-01-01',topics:['AI']},{itemId:1,title:'A copy',kind:'product'},{itemId:2,title:'Stale',kind:'news'},{itemId:3,title:'C',kind:'product'},{itemId:3,title:'Bad',kind:'other'}]};
  const result=buildFeed(payload,items,{},NOW);
  assert.equal(result.length,2);assert.equal(result[0].score,undefined);assert.equal(result[0].publishedAt,items[0].publishedAt);
  const feedback=applyFeedback({},result[0],-1,NOW);
  assert.deepEqual(buildFeed(payload,items,feedback,NOW).map(i=>i.id),[3]);
});
test('votes toggle, switch and persist bounded preference examples without banning a source',()=>{
  const item={url:'https://tool.example/',title:'Tool',source:'HN',topics:['AI agents']};
  let feedback=applyFeedback({},item,1,NOW);
  assert.equal(feedbackExamples(feedback)[0].vote,1);
  feedback=applyFeedback(feedback,item,-1,NOW+1);
  assert.equal(feedbackExamples(feedback)[0].vote,-1);
  assert.deepEqual(applyFeedback(feedback,item,-1,NOW+2),{});
  assert.throws(()=>applyFeedback({},item,5));
});
test('official announcements take provenance priority over duplicate community coverage',()=>{
  const url='https://www.anthropic.com/news/new-model';
  const evidence=buildEvidence([
    {ok:true,item:{title:'HN',url:'https://news.ycombinator.com/'},links:[{title:'New model',url,score:200}]},
    {ok:true,item:{title:'Anthropic News',lab:'Anthropic',url:'https://www.anthropic.com/news'},links:[{title:'New model',url,publishedAt:new Date(NOW).toISOString()},{title:'News',url:'https://www.anthropic.com/news'},{title:'External',url:'https://another.example/news/update'}]}
  ]);
  assert.equal(evidence.items[0].lab,'Anthropic');
  assert.equal(evidence.items[0].source,'Anthropic News');
  assert.equal(evidence.items[0].score,200);
  assert.equal(evidence.items.find(i=>i.title==='External').lab,null);
});
test('Google developer announcements are always watched and single-segment article paths retain lab provenance',()=>{
  const sources=selectSources([],sourceCandidates([]));
  assert.ok(sources.some(s=>s.url==='https://developers.googleblog.com/'));
  assert.ok(sources.some(s=>s.url==='https://blog.google/innovation-and-ai/'));
  const date='2026-10-06T00:00:00Z';
  const evidence=buildEvidence([{ok:true,item:sources.find(s=>s.title==='Google Developers Blog'),text:'October 6, 2026: EmbeddingGemma 2 launch.',links:[{title:'EmbeddingGemma 2: The Developer Guide',url:'https://developers.googleblog.com/embeddinggemma-2-the-developer-guide/',publishedAt:date}]}]);
  assert.equal(evidence.items[0].lab,'Google AI');
  const picks=buildFeed({items:[{itemId:1,title:'EmbeddingGemma 2',kind:'news'}]},evidence.items,{},Date.parse('2026-10-12T12:00:00Z'));
  assert.equal(picks.length,1);
  assert.equal(picks[0].lab,'Google AI');
});
test('practical impact outranks recency, popularity and lab branding',()=>{
  const quote='The release enables local multimodal retrieval without a cloud service.';
  const evidence=[
    {id:1,url:'https://lab.example/partnership',title:'A partnership',lab:'Big Lab',score:10000,publishedAt:new Date(NOW).toISOString(),evidenceContext:'A partnership announcement.'},
    {id:2,url:'https://tool.example/release',title:'Local retrieval release',publishedAt:new Date(NOW-3*86400000).toISOString(),evidenceContext:quote+' The open model is available for developers to download and use today.'}
  ];
  const result=buildFeed({items:[
    {itemId:1,title:'Partnership',kind:'news',impact:{capability:0,relevance:1,actionability:0,breadth:1,confidence:'uncertain',why:'No usable change.'}},
    {itemId:2,title:'Local retrieval release',kind:'product',impact:{capability:3,relevance:3,actionability:2,breadth:2,confidence:'reported',quote,why:'You can build local search without a cloud dependency.'}}
  ]},evidence,{},NOW);
  assert.deepEqual(result.map(i=>i.id),[2,1]);
  assert.equal(result[0].impact.confidence,'reported');
  assert.ok(result[0].impact.score>=28);
  assert.equal(result[0].evidenceContext,undefined,'do not persist whole extraction contexts');
});
test('unsupported or title-only impact estimates are discounted and scores are bounded',()=>{
  const {assessImpact}=require('../src/discovery');
  const inflated={capability:999,relevance:999,actionability:999,breadth:999,confidence:'reported',quote:'This is not in the source',why:'Unsubstantiated consequence'};
  const result=assessImpact(inflated,{title:'A release',evidenceContext:'A release'});
  assert.equal(result.score,21);
  assert.equal(result.confidence,'uncertain');
  assert.equal(result.quote,'');
  assert.equal(assessImpact({capability:'3',relevance:Infinity},{}).score,0);
});
test('feed truncates after impact ranking rather than dropping a consequential later item',()=>{
  const quote='Users must migrate their integrations before the endpoint is removed.';
  const evidence=Array.from({length:17},(_,i)=>({id:i+1,url:`https://tool.example/${i}`,title:'Endpoint deprecation',evidenceContext:quote+' The provider documents the migration and replacement endpoint in this notice.',publishedAt:new Date(NOW).toISOString()}));
  const payload={items:evidence.map((item,i)=>({itemId:item.id,title:'Endpoint deprecation',kind:'news',impact:{capability:i===16?3:0,relevance:3,actionability:3,breadth:2,confidence:'reported',quote,why:'Migrate your integration.'}}))};
  const items=buildFeed(payload,evidence,{},NOW);
  assert.equal(items.length,16);
  assert.equal(items[0].id,17);
});
