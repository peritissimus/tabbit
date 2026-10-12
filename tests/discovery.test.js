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
