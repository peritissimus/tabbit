const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const createReader = require('../src/publisher-reader');
const { normalizeUrlForDuplicate } = require('../src/organizer');
const { SOURCES, buildEvidence, buildFeed } = require('../src/discovery');
const source = SOURCES.find(s => s.rss);
const xml = fs.readFileSync(`${__dirname}/fixtures/google-release-rss.xml`, 'utf8');
const now = Date.parse('2026-10-14T12:00:00Z');
test('real Google RSS supplies Argon publisher date and description, excluding unrelated channels', async () => {
  const reader = createReader({fetch: async url => {
    assert.equal(url, source.rss);
    return {ok:true, text:async()=>xml};
  }});
  const page = await reader.readSource(source);
  assert.equal(page.ok, true);
  assert.equal(page.links.length, 2);
  const launch = page.links.find(l=>l.title.includes('available for developers'));
  assert.equal(launch.publishedAt, '2026-10-13T16:00:00.000Z');
  assert.ok(launch.context.includes('Build complex software'));
  assert.ok(!launch.context.includes('<img'));
  const evidence = buildEvidence([page]);
  const feed = buildFeed({items:evidence.items.map(i=>({itemId:i.id, title:i.title,kind:'news'}))},evidence.items,{},now);
  assert.equal(feed[0].url, launch.url);
  assert.equal(feed[0].modelRelease, true);
  assert.equal(feed[1].modelRelease, false);
});
test('publisher failures and malformed feeds return fallback signal', async () => {
  for (const fetch of [async()=>{throw Error('offline')}, async()=>({ok:true,text:async()=>'<html>Login</html>'})]) {
    assert.equal((await createReader({fetch}).readSource(source)).ok,false);
  }
});
test('fresh official launches lead ordinary high-scoring stories; stale, unknown and unofficial releases do not', () => {
  const launch = {id:1,url:'https://blog.google/innovation-and-ai/models/release/',lab:'Google AI',title:'Gemini 4 Argon is now available for developers',evidenceContext:'Gemini 4 Argon is now available for developers. Build complex software and cybersecurity workflows using the new model.',publishedAt:'2026-10-13T16:00:00Z'};
  const ordinary = {id:2,url:'https://example.com/tool',title:'Useful tool',evidenceContext:'A useful tool enables automated builds and deployment across all your repositories today.',publishedAt:'2026-10-14T00:00:00Z'};
  const picks = {items:[{itemId:1,title:launch.title,kind:'news'},{itemId:2,title:ordinary.title,kind:'news',impact:{capability:3,relevance:3,actionability:3,breadth:3,confidence:'reported',quote:ordinary.evidenceContext}}]};
  assert.equal(buildFeed(picks,[launch,ordinary],{},now)[0].id,1);
  for(const override of [{lab:null},{publishedAt:null},{publishedAt:'2026-10-06T16:00:00Z'},{publishedAt:'2026-10-15T00:00:00Z'},{title:'Gemini model tutorial'}]) {
    assert.equal(buildFeed(picks,[{...launch,...override},ordinary],{},now)[0].id,2);
  }
  assert.equal(buildFeed(picks,[launch,ordinary],{[normalizeUrlForDuplicate(launch.url)]:{vote:-1}},now)[0].id,2);
});
test('official undated links do not inherit HN submission freshness',()=>{
  const url='https://blog.google/innovation-and-ai/models/release/';
  const evidence=buildEvidence([{ok:true,item:{title:'HN',url:'https://news.ycombinator.com/'},links:[{url,title:'Model now available',publishedAt:'2026-10-14T00:00:00Z'}]}, {ok:true,item:source,links:[{url,title:'Model now available'}]}]);
  assert.equal(evidence.items[0].publishedAt,null);
});
