(function initDiscovery(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./workspace"), require("./organizer"));
  else root.TabbitDiscovery = factory(root.TabbitWorkspace, root.TabbitOrganizer);
})(typeof self !== "undefined" ? self : this, function createDiscovery(workspace, organizer) {
  const { normalizeUrlForDuplicate } = organizer;
  // Editable in Tune feed; derived from the owner-approved work patterns, not private source code.
  const DEFAULT_WORK_PROFILE = "I build production agents and personal developer tools. Prioritize: reliable coding and voice agents, tool calling, evaluations, grounded answers and repository/PR workflows; local-first AI, embeddings, rerankers, semantic search, transcription and memory-efficient inference; production reliability, durable jobs, queues, permissions, retries, observability and latency/cost improvements; creative browser tools, Three.js/WebGPU, native desktop software, recoverable editing and interface craft. Wearables and glanceable interfaces are occasional interests. Prefer usable capabilities and concrete engineering advances over funding, partnerships, generic tutorials or benchmark-only hype. Explain the connection to a workflow, without claiming I use a product just because it matches these interests.";
  const SOURCES = [
    { title: "Hacker News", url: "https://news.ycombinator.com/", topics: ["engineering", "AI", "startups"] },
    { title: "Show HN", url: "https://news.ycombinator.com/show", topics: ["new products", "developer tools", "personal software"] },
    { title: "Product Hunt", url: "https://www.producthunt.com/", topics: ["new products", "design", "AI"] },
    { title: "Techmeme", url: "https://www.techmeme.com/", topics: ["technology", "AI", "industry news"] },
    { title: "GitHub Changelog", url: "https://github.blog/changelog/", topics: ["developer tools", "engineering", "AI"] },
    { title: "Anthropic News", lab: "Anthropic", url: "https://www.anthropic.com/news", topics: ["AI", "agents", "coding"] },
    { title: "OpenAI News", lab: "OpenAI", url: "https://openai.com/news/", topics: ["AI", "agents", "voice"] },
    { title: "Google DeepMind", lab: "Google DeepMind", url: "https://deepmind.google/discover/blog/", topics: ["AI", "models", "research"] },
    { title: "Google Developers Blog", lab: "Google AI", url: "https://developers.googleblog.com/", topics: ["AI", "Gemma", "on-device AI", "developer releases"] },
    { title: "Google AI Announcements", rss: "https://blog.google/rss/", lab: "Google AI", url: "https://blog.google/innovation-and-ai/", topics: ["AI", "Gemini", "Gemma", "models"] },
    { title: "Meta AI", lab: "Meta AI", url: "https://research.meta.ai/", topics: ["AI", "models", "agents", "research"] },
    { title: "xAI News", lab: "xAI", url: "https://x.ai/news", topics: ["AI", "models", "agents"] },
    { title: "Mistral News", lab: "Mistral", url: "https://mistral.ai/news/", topics: ["AI", "open models", "voice"] },
    { title: "Hugging Face Blog", url: "https://huggingface.co/blog", topics: ["AI", "open source", "local models"] },
    { title: "Vercel Blog", url: "https://vercel.com/blog", topics: ["frontend", "developer tools", "AI"] },
    { title: "Cloudflare Blog", url: "https://blog.cloudflare.com/", topics: ["infrastructure", "engineering"] },
    { title: "Simon Willison", url: "https://simonwillison.net/", topics: ["AI", "agents", "engineering"] },
    { title: "Lobsters", url: "https://lobste.rs/", topics: ["engineering", "open source"] },
    { title: "Ars Technica", url: "https://arstechnica.com/", topics: ["technology", "engineering"] },
    { title: "TechCrunch", url: "https://techcrunch.com/", topics: ["startups", "new products", "AI"] },
    { title: "The Verge", url: "https://www.theverge.com/", topics: ["technology", "design", "new products"] },
    { title: "Smashing Magazine", url: "https://www.smashingmagazine.com/", topics: ["design", "frontend"] },
    { title: "Stripe Blog", url: "https://stripe.com/blog", topics: ["business software", "engineering"] }
  ];
  const clip = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  const hostMatches = (host, base) => host === base || host.endsWith(`.${base}`);
  function publicUrl(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || !host.includes(".") || host.includes(":") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) || /^\d+(?:\.\d+){3}$/.test(host) || !workspace.isReadableUrl(url.href) || workspace.isAuthenticationUrl(url.href)) return null;
      return url;
    } catch (_) { return null; }
  }
  function browsingProfile(history, context = "", now = Date.now()) {
    const internal = workspace.parseInternalDomains(context);
    const allowed = ["github.com", "github.blog", "gitlab.com", "developer.mozilla.org", "developer.chrome.com", "stackoverflow.com", "npmjs.com", "docs.python.org", "react.dev", "nextjs.org", "rust-lang.org", ...SOURCES.map(s => new URL(s.url).hostname.replace(/^www\./,""))];
    const domains = new Map();
    for (const item of history) {
      const url = publicUrl(item.url);
      if (!url || now - (item.lastVisitTime || 0) > 14 * 86400000) continue;
      const host = url.hostname.replace(/^www\./, "");
      if (internal.some(base => hostMatches(host, base)) || !allowed.some(base => hostMatches(host, base))) continue;
      const record = domains.get(host) || { host, visits: 0, titles: [], lastVisitTime: 0 };
      record.visits += Math.min(Math.max(Number(item.visitCount) || 1, 1), 100);
      record.lastVisitTime = Math.max(record.lastVisitTime, item.lastVisitTime || 0);
      const title = clip(item.title, 100);
      if (title && !record.titles.includes(title) && record.titles.length < 4) record.titles.push(title);
      domains.set(host, record);
    }
    return [...domains.values()].sort((a,b) => b.visits - a.visits).slice(0, 24);
  }
  function sourceCandidates(profile) {
    return SOURCES.map((s, i) => ({ ...s, id: i + 1, visits: profile.filter(p => hostMatches(p.host, new URL(s.url).hostname.replace(/^www\./,""))).reduce((n,p)=>n+p.visits,0) }))
      .sort((a,b)=>b.visits-a.visits);
  }
  function selectSources(ids, candidates) {
    const selected = new Set(Array.isArray(ids) ? ids.map(Number) : []);
    // Always watch the major labs and community launches; personalize the remaining sources.
    const base = candidates.filter(s => s.title === "Hacker News" || s.title === "Show HN" || s.lab);
    base.sort((a,b) => Number(Boolean(a.lab)) - Number(Boolean(b.lab)));
    const rest = candidates.filter(s => selected.has(s.id) && !base.includes(s));
    return [...base, ...(rest.length ? rest : candidates.filter(s => !base.includes(s)).slice(0, 3))].slice(0, 14);
  }
  function buildEvidence(pages) {
    const items = [], seen = new Map(), evidencePages = [];
    for (const page of pages.filter(p => p.ok)) {
      const links = [];
      for (const link of (page.links || [])) {
        const url = publicUrl(link.url);
        if (!url || !clip(link.title,140)) continue;
        const sourceUrl = new URL(page.item.url);
        const lab = page.item.lab && url.hostname.replace(/^www\./, "") === sourceUrl.hostname.replace(/^www\./, "") && url.pathname !== sourceUrl.pathname && url.pathname.split("/").filter(Boolean).length >= (sourceUrl.pathname === "/" ? 1 : 2) ? page.item.lab : null;
        const key = normalizeUrlForDuplicate(url.href);
        let item = seen.get(key);
        if (!item) {
          item = { id: items.length + 1, title: clip(link.title, 140), url: url.href, source: page.item.title, sourceUrl: page.item.url, lab, evidenceContext: clip(link.context || link.title, 800), publishedAt: link.publishedAt || null, score: Number.isFinite(link.score) ? link.score : null, comments: Number.isFinite(link.comments) ? link.comments : null };
          seen.set(key, item); items.push(item);
        } else if (lab) {
          item.lab = lab;
          item.source = page.item.title;
          item.sourceUrl = page.item.url;
          item.publishedAt = link.publishedAt || null; // Never borrow a community submission date for an official release.
          item.evidenceContext = clip(link.context || link.title, 800);
        }
        links.push({ id: item.id, title: item.title, lab: item.lab, context: item.evidenceContext, publishedAt: item.publishedAt, score: item.score, comments: item.comments });
      }
      evidencePages.push({ source: page.item.title, lab: page.item.lab || null, text: clip(page.text, 10000), links });
    }
    return { items, pages: evidencePages };
  }
  function assessImpact(value, item) {
    const input = value && typeof value === "object" ? value : {};
    const level = key => Number.isFinite(input[key]) ? Math.max(0, Math.min(3, Math.round(input[key]))) : 0;
    const quote = clip(input.quote, 240);
    const context = clip(item.evidenceContext, 800);
    const supported = input.confidence === "reported" && quote.length >= 12 && context.includes(quote) && context.length > String(item.title || "").length + 40;
    const capability = Math.min(level("capability"), supported ? 3 : 1);
    const relevance = level("relevance");
    const actionability = Math.min(level("actionability"), supported ? 3 : 1);
    const breadth = Math.min(level("breadth"), supported ? 3 : 1);
    return { capability, relevance, actionability, breadth, confidence: supported ? "reported" : "uncertain", why: clip(input.why,160), quote: supported ? quote : "", score: capability * 5 + relevance * 4 + actionability * 3 + breadth };
  }
  function isModelRelease(item) {
    const text = `${item.title}. ${item.evidenceContext || ""}`;
    return Boolean(item.lab && item.evidenceContext &&
      /\b(model|gemini|gemma|claude|gpt|grok|llama|mistral|embedding|agent|agents|inference|speech|AI)\b/i.test(text) &&
      /\b(introducing|releasing|launching|released|launched|now available|now access|giving.{0,60}access|comes to)\b/i.test(text) &&
      !/\b(roundup|partnership|funding|rumou?r|reportedly|tutorial)\b/i.test(item.title));
  }
  function rankFeed(items, now = Date.now()) {
    const priority = item => {
      const published = Date.parse(item.publishedAt);
      // Preserve full impact for two days, then decay smoothly. Unknown dates
      // must not receive the same freshness credit as verified recent dates.
      const ageDays = Math.max(0, (now - published) / 86400000);
      const freshness = Number.isFinite(published) ? 1 / (1 + Math.max(0, ageDays - 2) / 3) : 0.6;
      // Fresh official AI launches get a seven-day editorial priority, not an
      // inflated impact score. Unknown, future and old dates cannot claim it.
      const launchPriority = item.lab && item.modelRelease && published <= now && ageDays <= 7 ? 50 : 0;
      return launchPriority + (item.impact?.score || 0) * freshness;
    };
    return [...items].sort((a,b) => priority(b) - priority(a) || (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0) || Math.min(b.score || 0,1000) - Math.min(a.score || 0,1000));
  }
  function buildFeed(payload, evidence, feedback = {}, now = Date.now()) {
    const byId = new Map(evidence.map(item => [item.id, item])), seen = new Set(), selected = [];
    for (const entry of Array.isArray(payload?.items) ? payload.items.slice(0,64) : []) {
      const item = byId.get(Number(entry.itemId));
      if (!item || seen.has(item.url) || !["news", "product"].includes(entry.kind) || !clip(entry.title,100)) continue;
      const key = normalizeUrlForDuplicate(item.url);
      if ([1, -1].includes(feedback[key]?.vote)) continue;
      // Structured sources provide exact timestamps. Never promote old links as fresh.
      const published = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
      if (Number.isFinite(published) && (published > now + 86400000 || now - published > (entry.kind === "product" ? 14 : 7) * 86400000)) continue;
      seen.add(item.url);
      const impact = assessImpact(entry.impact, item);
      const { evidenceContext, ...publicItem } = item;
      selected.push({ ...publicItem, modelRelease: isModelRelease(item), impact, title: clip(entry.title,100), kind: entry.kind, summary: clip(entry.summary,180), reason: clip(entry.reason,120), topics: [...new Set((Array.isArray(entry.topics) ? entry.topics : []).map(t=>clip(t,32)).filter(Boolean))].slice(0,3) });
    }
    return rankFeed(selected, now).slice(0,16);
  }
  function feedbackExamples(feedback) {
    return Object.values(feedback || {}).filter(r => r && (r.vote === 1 || r.vote === -1)).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,40)
      .map(({vote,title,topics,source})=>({vote,title,topics,source}));
  }
  function applyFeedback(feedback, item, vote, now = Date.now()) {
    const next = { ...feedback }, key = normalizeUrlForDuplicate(item.url);
    if (![1,-1,0].includes(vote)) throw new Error("Invalid feedback");
    if (vote === 0 || next[key]?.vote === vote) delete next[key];
    else next[key] = { ...item, vote, updatedAt:now };
    return Object.fromEntries(Object.entries(next).sort((a,b)=>(b[1].updatedAt||0)-(a[1].updatedAt||0)));
  }
  return { DEFAULT_WORK_PROFILE, SOURCES, browsingProfile, sourceCandidates, selectSources, buildEvidence, buildFeed, assessImpact, rankFeed, feedbackExamples, applyFeedback, publicUrl };
});
