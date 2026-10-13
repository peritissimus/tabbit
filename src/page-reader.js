"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitPageReader = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({
    chrome,
    organizer,
    discovery,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) {
    const { normalizeUrlForDuplicate } = organizer;
    const PAGE_LOAD_TIMEOUT_MS = 20 * 1000;
    const PAGE_SETTLE_MS = 2500;
    const PAGE_TEXT_LIMIT = 6000;
    const PAGE_LINK_LIMIT = 40;
    const MIN_PAGE_TEXT = 80;

    async function closeScrapeWindow(windowId) {
      if (typeof windowId !== "number") {
        return;
      }

      try {
        await chrome.windows.remove(windowId);
      } catch (_error) {
        // Already closed.
      }
    }

    // Runs inside the page. Must stay self-contained.
    function extractPage(textLimit, linkLimit) {
      const root = /** @type {HTMLElement} */ (
        document.querySelector("main, [role='main']") || document.body
      );
      const text = String(root?.innerText || "")
        .replace(/[ \t]+/g, " ")
        .replace(/\s*\n\s*/g, "\n")
        .trim()
        .slice(0, textLimit);

      const links = [];
      const seen = new Set([location.href.split("#")[0]]);

      for (const anchor of root
        ? root.querySelectorAll(/** @type {"a"} */ ("a[href]"))
        : []) {
        const title = String(
          anchor.querySelector(/** @type {"h1"} */ ("h1,h2,h3,h4"))
            ?.innerText ||
            anchor.getAttribute("aria-label") ||
            anchor.innerText ||
            "",
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140);
        const url = anchor.href.split("#")[0];

        if (!/^https?:/.test(url) || seen.has(url) || title.length < 3) {
          continue;
        }

        seen.add(url);
        let publishedAt = null;
        let node =
          anchor.closest(/** @type {"article"} */ ("article,li")) ||
          anchor.parentElement;
        for (
          let depth = 0;
          node && node !== root && depth < 3;
          depth++, node = node.parentElement
        ) {
          const time = node
            .querySelector("time[datetime]")
            ?.getAttribute("datetime");
          if (time && Number.isFinite(Date.parse(time))) {
            publishedAt = new Date(time).toISOString();
            break;
          }
          // Some publishers render dates as plain text inside the announcement card.
          // Avoid borrowing the first date from an entire grid or navigation group.
          if (node.querySelectorAll("a[href]").length <= 3) {
            const matches =
              String(node.innerText || "").match(
                /(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4}/gi,
              ) || [];
            if (
              matches.length === 1 &&
              Number.isFinite(Date.parse(matches[0]))
            ) {
              publishedAt = new Date(matches[0]).toISOString();
              break;
            }
          }
        }
        const context = String(
          (
            anchor.closest(/** @type {"article"} */ ("article,li")) ||
            anchor.parentElement
          )?.innerText || title,
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 800);
        links.push({ title, url, publishedAt, context });

        if (links.length >= linkLimit) {
          break;
        }
      }

      return { title: document.title, url: location.href, text, links };
    }

    async function readTab(tabId, item) {
      try {
        const [injection] = await chrome.scripting.executeScript({
          args: item.discovery
            ? [12000, 80]
            : [PAGE_TEXT_LIMIT, PAGE_LINK_LIMIT],
          func: extractPage,
          target: { tabId },
        });
        const page = injection?.result;

        if (item.discovery) {
          const final = discovery.publicUrl(page?.url);
          const expectedHost = new URL(item.url).hostname.replace(/^www\./, "");
          if (!final || final.hostname.replace(/^www\./, "") !== expectedHost) {
            return {
              item,
              ok: false,
              error: "Source redirected outside its public content",
            };
          }
          if (
            /just a moment|access denied|403 forbidden|page not found/i.test(
              page.title || "",
            ) ||
            (page.text?.length < 1000 &&
              /verify (?:that )?you are human|checking your browser|enable javascript and cookies/i.test(
                page.text,
              ))
          ) {
            return { item, ok: false, error: "Source blocked or unavailable" };
          }
        }
        if (!page || page.text.length < MIN_PAGE_TEXT) {
          return { item, ok: false, error: "No readable text" };
        }

        return {
          item,
          ok: true,
          title: page.title || item.title,
          text: page.text,
          links: page.links,
        };
      } catch (error) {
        return {
          item,
          ok: false,
          error: error.message || "Could not read page",
        };
      }
    }

    async function waitForLoad(tabId) {
      const deadline = Date.now() + PAGE_LOAD_TIMEOUT_MS;

      while (Date.now() < deadline) {
        const tab = await chrome.tabs.get(tabId);

        if (tab.status === "complete") {
          break;
        }

        await sleep(500);
      }

      // Give client-rendered pages a moment to fill in.
      await sleep(PAGE_SETTLE_MS);
    }

    // Pages already open are read in place. The rest load in a minimized window,
    // signed in as the user, which is closed again when the read is done.
    async function readPages(targets, tabs, progress = async (_patch) => {}) {
      const openByUrl = new Map();

      for (const tab of tabs) {
        const key = normalizeUrlForDuplicate(tab.url);

        if (
          key &&
          !tab.discarded &&
          tab.status === "complete" &&
          !openByUrl.has(key)
        ) {
          openByUrl.set(key, tab);
        }
      }

      const pagesById = new Map();
      const toLoad = [];
      const openReads = [];

      for (const item of targets) {
        const tab = openByUrl.get(normalizeUrlForDuplicate(item.url));

        if (tab) {
          openReads.push(
            readTab(tab.id, item).then((page) => pagesById.set(item.id, page)),
          );
        } else {
          toLoad.push(item);
        }
      }

      if (toLoad.length > 0) {
        const scrapeWindow = await chrome.windows.create({
          state: "minimized",
          url: toLoad.map((item) => item.url),
        });
        await progress({ scrapeWindowId: scrapeWindow.id });

        try {
          await Promise.all(
            toLoad.map(async (item, index) => {
              const tab = scrapeWindow.tabs?.[index];

              if (!tab) {
                pagesById.set(item.id, {
                  item,
                  ok: false,
                  error: "Could not open page",
                });
                return;
              }

              try {
                await waitForLoad(tab.id);
                pagesById.set(item.id, await readTab(tab.id, item));
              } catch (error) {
                pagesById.set(item.id, {
                  item,
                  ok: false,
                  error: error.message || "Could not open page",
                });
              }
            }),
          );
        } finally {
          await closeScrapeWindow(scrapeWindow.id);
          await progress({ scrapeWindowId: null });
        }
      }

      await Promise.all(openReads);
      return targets.map((item) => pagesById.get(item.id));
    }

    return { readPages, readTab, closeScrapeWindow };
  },
);
