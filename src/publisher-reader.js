"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitPublisherReader = factory;
})(typeof self !== "undefined" ? self : this, function ({ fetch }) {
  // Read bounded RSS text without executing publisher HTML in the worker.
  function decode(value) {
    return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
        const code = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }).replace(/&(lt|gt|quot|apos|amp);/g, (_, key) => ({lt:"<",gt:">",quot:'"',apos:"'",amp:"&"})[key]);
  }
  function parseRss(xml, source) {
    const links = [];
    for (const match of xml.slice(0, 2000000).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
      const field = name => decode(match[1].match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] || "");
      const plain = value => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const title = plain(field("title"));
      let url;
      try { url = new URL(field("link").trim()); } catch { continue; }
      if (url.protocol !== "https:" || url.hostname !== new URL(source.url).hostname || !url.pathname.startsWith(new URL(source.url).pathname)) continue;
      const date = Date.parse(field("pubDate"));
      if (!title || !Number.isFinite(date)) continue;
      links.push({ title, url: url.href, publishedAt: new Date(date).toISOString(), context: `${title}. ${plain(field("description"))}`.slice(0, 800) });
      if (links.length === 80) break;
    }
    return links;
  }
  async function readSource(source) {
    try {
      const response = await fetch(source.rss, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const links = parseRss(await response.text(), source);
      if (!links.length) throw new Error("No dated publisher items");
      return { item: source, ok: true, links, text: JSON.stringify(links) };
    } catch (error) { return { item: source, ok: false, error: error.message }; }
  }
  return { readSource, parseRss };
});
