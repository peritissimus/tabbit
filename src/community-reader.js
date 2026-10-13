"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitCommunityReader = factory;
})(typeof self !== "undefined" ? self : this, function ({ fetch }) {
  async function fetchHnSource(source) {
    try {
      const endpoint =
        source.title === "Show HN" ? "showstories" : "topstories";
      const fetchJson = async (url) => {
        const result = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!result.ok) throw new Error(`HTTP ${result.status}`);
        return result.json();
      };
      const ids = (
        await fetchJson(
          `https://hacker-news.firebaseio.com/v0/${endpoint}.json`,
        )
      ).slice(0, 30);
      // Keep five requests active without making each batch wait for its slowest item.
      // Store by index so network completion order cannot change editorial input order.
      const results = new Array(ids.length);
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(5, ids.length) }, async () => {
          while (next < ids.length) {
            const index = next++;
            try {
              results[index] = await fetchJson(
                `https://hacker-news.firebaseio.com/v0/item/${ids[index]}.json`,
              );
            } catch (_error) {
              /* One unavailable story must not block the other sources. */
            }
          }
        }),
      );
      const stories = results.filter(
        (story) =>
          story?.type === "story" && !story.dead && !story.deleted && story.url,
      );
      const links = stories.map((s) => ({
        title: s.title,
        url: s.url,
        publishedAt: new Date(s.time * 1000).toISOString(),
        score: s.score || 0,
        comments: s.descendants || 0,
      }));
      return {
        item: source,
        ok: links.length > 0,
        error: links.length ? "" : "No current stories",
        text: JSON.stringify(links),
        links,
      };
    } catch (error) {
      return { item: source, ok: false, error: error.message };
    }
  }

  return { fetchHnSource };
});
