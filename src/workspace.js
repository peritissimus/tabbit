(function initWorkspace(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./organizer"));
    return;
  }

  root.TabbitWorkspace = factory(root.TabbitOrganizer);
})(typeof self !== "undefined" ? self : this, function createWorkspace(organizer) {
  const { isGroupableTab, normalizeUrlForDuplicate } = organizer;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_HISTORY_DAYS = 14;
  const MIN_SITE_VISITS = 2;
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

  // Search and sign-in hops say nothing about what the user is working on.
  const SKIPPED_HOSTS = new Set(["google.com", "bing.com", "duckduckgo.com", "accounts.google.com"]);

  // Pages the brief must never open or read on the user's behalf.
  const UNREADABLE_HOSTS = ["mail.google.com", "outlook.live.com", "outlook.office.com", "accounts.google.com"];
  const UNREADABLE_HOST_PATTERN = /bank|paypal|payroll|wallet/;
  // Reading a page can mean loading it, so skip URLs that look like actions.
  const RISKY_URL_PATTERN = /log-?out|sign-?out|delete|remove|unsubscribe|confirm|approve|oauth|callback|checkout/i;

  const CATEGORY_ORDER = ["Internal", "Infra", "Code", "Comms", "AI", "Docs", "Other"];
  const CATEGORY_COLORS = {
    AI: "green",
    Code: "purple",
    Comms: "blue",
    Docs: "yellow",
    Infra: "red",
    Internal: "orange",
    Other: "grey"
  };

  const SITE_RULES = [
    {
      title: "Infra",
      hosts: [
        "aws.amazon.com",
        "amazonaws.com",
        "awsapps.com",
        "datadoghq.com",
        "grafana.com",
        "grafana.net",
        "sentry.io",
        "cloud.google.com",
        "vercel.com",
        "cloudflare.com",
        "terraform.io",
        "pagerduty.com",
        "newrelic.com"
      ]
    },
    {
      title: "Code",
      hosts: ["github.com", "gitlab.com", "bitbucket.org", "npmjs.com"]
    },
    {
      title: "Comms",
      hosts: [
        "slack.com",
        "mail.google.com",
        "calendar.google.com",
        "meet.google.com",
        "linear.app",
        "notion.so",
        "discord.com",
        "atlassian.net",
        "zoom.us"
      ]
    },
    {
      title: "AI",
      hosts: ["chatgpt.com", "claude.ai", "gemini.google.com", "perplexity.ai"]
    },
    {
      title: "Docs",
      hosts: [
        "developer.mozilla.org",
        "developer.chrome.com",
        "readthedocs.io",
        "stackoverflow.com",
        "docs.google.com",
        "drive.google.com"
      ]
    }
  ];

  function normalizeHost(hostname) {
    return String(hostname || "")
      .toLowerCase()
      .replace(/^www\./, "");
  }

  function hostMatches(host, expectedHost) {
    return host === expectedHost || host.endsWith(`.${expectedHost}`);
  }

  function clip(value, maxLength) {
    const cleaned = String(value || "").replace(/\s+/g, " ").trim();
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trim()}…` : cleaned;
  }

  // The Context setting doubles as the list of company domains: every
  // wildcard such as "*.acme.dev" becomes an Internal domain.
  function parseInternalDomains(context) {
    const domains = new Set();
    const pattern = /\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;

    for (const match of String(context || "").matchAll(pattern)) {
      domains.add(match[1].toLowerCase());
    }

    return [...domains];
  }

  function categorizeSite(hostname, internalDomains = []) {
    const host = normalizeHost(hostname);

    if (!host || SKIPPED_HOSTS.has(host)) {
      return null;
    }

    if (internalDomains.some((domain) => hostMatches(host, domain))) {
      return "Internal";
    }

    for (const rule of SITE_RULES) {
      if (rule.hosts.some((ruleHost) => hostMatches(host, ruleHost))) {
        return rule.title;
      }
    }

    return host.startsWith("docs.") ? "Docs" : "Other";
  }

  function recency(lastVisitTime, now, days) {
    return Math.max(0, 1 - (now - lastVisitTime) / (days * DAY_MS));
  }

  // Sign-in handoffs are transient, not useful destinations to revisit or probe.
  function isAuthenticationUrl(url) {
    try {
      const parsed = new URL(url);
      return /(?:^|\/)(?:oauth2?|callback|signin|sign-in|login|logout|authorize|authentication_result)(?:\/|$)/i.test(parsed.pathname)
        || /(?:[?&#])(?:code|access_token|id_token|refresh_token|callback|callback_url)=/i.test(parsed.search + parsed.hash);
    } catch (_error) {
      return false;
    }
  }

  function collectPages(historyItems) {
    const pagesByKey = new Map();

    for (const item of Array.isArray(historyItems) ? historyItems : []) {
      const key = normalizeUrlForDuplicate(item?.url);
      const parsed = key ? new URL(key) : null;

      if (!parsed || parsed.protocol === "file:" || isAuthenticationUrl(item.url)) {
        continue;
      }

      const visits = Math.max(1, Number(item.visitCount) || 1);
      const lastVisitTime = Number(item.lastVisitTime) || 0;
      const title = clip(item.title, 160);
      const page = pagesByKey.get(key);

      if (!page) {
        pagesByKey.set(key, {
          key,
          host: normalizeHost(parsed.hostname),
          origin: parsed.origin,
          label: parsed.host,
          title: title || parsed.host + parsed.pathname,
          url: item.url,
          visits,
          lastVisitTime
        });
        continue;
      }

      page.visits += visits;

      if (lastVisitTime > page.lastVisitTime) {
        page.lastVisitTime = lastVisitTime;
        page.url = item.url;
        page.title = title || page.title;
      }
    }

    return [...pagesByKey.values()];
  }

  function buildLocalServers(localPages, maxServers) {
    const servers = new Map();

    for (const page of localPages) {
      const server = servers.get(page.origin);

      if (!server) {
        servers.set(page.origin, {
          origin: page.origin,
          label: page.label,
          title: page.title,
          url: page.url,
          visits: page.visits,
          lastVisitTime: page.lastVisitTime
        });
        continue;
      }

      server.visits += page.visits;

      if (page.lastVisitTime > server.lastVisitTime) {
        server.lastVisitTime = page.lastVisitTime;
        server.title = page.title;
        server.url = page.url;
      }
    }

    return [...servers.values()]
      .sort((left, right) => right.lastVisitTime - left.lastVisitTime)
      .slice(0, maxServers);
  }

  function buildWorkspace(historyItems, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const days = Number(options.days) > 0 ? Number(options.days) : DEFAULT_HISTORY_DAYS;
    const internalDomains = options.internalDomains || [];
    const maxSitesPerCategory = options.maxSitesPerCategory || 6;
    const maxPagesPerSite = options.maxPagesPerSite || 3;
    const maxPages = options.maxPages || 60;

    const pageScore = (page) => Math.min(page.visits / 20, 1) * 0.5 + recency(page.lastVisitTime, now, days) * 0.5;
    const byScore = (left, right) => right.score - left.score;

    const localPages = [];
    const sitesByHost = new Map();

    for (const page of collectPages(historyItems)) {
      page.score = pageScore(page);

      if (LOCAL_HOSTS.has(page.host)) {
        localPages.push(page);
        continue;
      }

      const category = categorizeSite(page.host, internalDomains);

      if (!category) {
        continue;
      }

      if (!sitesByHost.has(page.host)) {
        sitesByHost.set(page.host, {
          host: page.host,
          category,
          visits: 0,
          lastVisitTime: 0,
          pages: []
        });
      }

      const site = sitesByHost.get(page.host);
      site.visits += page.visits;
      site.lastVisitTime = Math.max(site.lastVisitTime, page.lastVisitTime);
      site.pages.push(page);
    }

    const sites = [...sitesByHost.values()].filter((site) => site.visits >= MIN_SITE_VISITS);

    // Frequency, recency, breadth, then daily consistency.
    for (const site of sites) {
      site.score =
        Math.min(site.visits / 50, 1) * 0.4 +
        recency(site.lastVisitTime, now, days) * 0.3 +
        Math.min(site.pages.length / 10, 1) * 0.2 +
        Math.min(site.visits / days / 5, 1) * 0.1;
    }

    sites.sort(byScore);

    const pages = [...sites.flatMap((site) => site.pages), ...localPages].sort(byScore).slice(0, maxPages);

    const categories = CATEGORY_ORDER.map((title) => ({
      title,
      color: CATEGORY_COLORS[title],
      sites: sites
        .filter((site) => site.category === title)
        .slice(0, maxSitesPerCategory)
        .map((site) => ({
          ...site,
          pages: [...site.pages].sort(byScore).slice(0, maxPagesPerSite)
        }))
    })).filter((category) => category.sites.length > 0);

    return {
      categories,
      localServers: buildLocalServers(localPages, options.maxLocalServers || 8),
      pages,
      siteCount: sites.length
    };
  }

  // Candidate pages for the AI brief. The model only ever refers to these by
  // id, so every link in a brief is a page the user really has open or visited.
  function buildBriefItems(tabs, pages, options = {}) {
    const maxOpen = options.maxOpen || 30;
    const maxItems = options.maxItems || 60;
    const items = [];
    const seen = new Set();

    function add(source, open) {
      const key = normalizeUrlForDuplicate(source.url);

      if (!key || isAuthenticationUrl(source.url) || seen.has(key) || items.length >= maxItems) {
        return;
      }

      seen.add(key);
      items.push({
        id: items.length + 1,
        title: clip(source.title || source.url, 160),
        url: source.url,
        open,
        visits: source.visits || 0,
        lastVisitTime: source.lastVisitTime || source.lastAccessed || 0
      });
    }

    for (const tab of (Array.isArray(tabs) ? tabs : []).slice(0, maxOpen)) {
      if (isGroupableTab(tab, { includePinned: true })) {
        add(tab, true);
      }
    }

    for (const page of Array.isArray(pages) ? pages : []) {
      add(page, false);
    }

    return items;
  }

  function isReadableUrl(url) {
    let parsed;

    try {
      parsed = new URL(url);
    } catch (_error) {
      return false;
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }

    const host = normalizeHost(parsed.hostname);

    if (UNREADABLE_HOSTS.some((blocked) => hostMatches(host, blocked)) || UNREADABLE_HOST_PATTERN.test(host)) {
      return false;
    }

    return !RISKY_URL_PATTERN.test(parsed.pathname + parsed.search);
  }

  // pickedIds is the model's choice; anything else (a failed pick) falls back
  // to the top-ranked readable items.
  function selectPagesToRead(pickedIds, items, options = {}) {
    const readable = (Array.isArray(items) ? items : []).filter((item) => isReadableUrl(item.url));

    if (!Array.isArray(pickedIds)) {
      return readable.slice(0, options.fallbackPages || 5);
    }

    const wanted = new Set(pickedIds.map(Number));
    return readable.filter((item) => wanted.has(item.id)).slice(0, options.maxPages || 8);
  }

  // Links found on the pages that were read become items too, so the brief
  // can point at a specific PR or ticket and still only use ids it was given.
  function addPageLinks(items, pages) {
    const allItems = [...items];
    const idsByKey = new Map(items.map((item) => [normalizeUrlForDuplicate(item.url), item.id]));

    const linkedPages = pages.map((page) => {
      const links = [];

      for (const link of page.links || []) {
        const key = normalizeUrlForDuplicate(link.url);
        const title = clip(link.title, 160);

        if (!key || !key.startsWith("http") || !title) {
          continue;
        }

        let id = idsByKey.get(key);

        if (!id) {
          id = allItems.length + 1;
          idsByKey.set(key, id);
          allItems.push({ id, title, url: link.url, open: false, visits: 0, lastVisitTime: 0 });
        }

        if (!links.some((existing) => existing.id === id)) {
          links.push({ id, title });
        }
      }

      return { ...page, links };
    });

    return { items: allItems, pages: linkedPages };
  }

  function buildBriefFromAi(payload, items, options = {}) {
    const maxThreads = options.maxThreads || 5;
    const maxLinks = options.maxLinks || 6;
    const maxAttention = options.maxAttention || 6;
    const itemsById = new Map((Array.isArray(items) ? items : []).map((item) => [item.id, item]));
    const usedIds = new Set();
    const threads = [];
    const attention = [];

    for (const entry of Array.isArray(payload?.attention) ? payload.attention : []) {
      const item = itemsById.get(Number(entry?.itemId));
      const text = clip(entry?.text, 160);

      if (item && text && attention.length < maxAttention) {
        attention.push({ text, title: item.title, url: item.url });
      }
    }

    for (const thread of Array.isArray(payload?.threads) ? payload.threads : []) {
      const links = [];

      for (const id of Array.isArray(thread?.itemIds) ? thread.itemIds : []) {
        const item = itemsById.get(Number(id));

        if (!item || usedIds.has(item.id) || links.length >= maxLinks) {
          continue;
        }

        usedIds.add(item.id);
        links.push({ title: item.title, url: item.url });
      }

      if (links.length === 0) {
        continue;
      }

      threads.push({
        title: clip(thread.title, 48) || "Untitled",
        note: clip(thread.note, 220),
        links
      });

      if (threads.length >= maxThreads) {
        break;
      }
    }

    return {
      headline: clip(payload?.headline, 220),
      attention,
      threads
    };
  }

  return {
    DEFAULT_HISTORY_DAYS,
    addPageLinks,
    buildBriefFromAi,
    buildBriefItems,
    buildWorkspace,
    categorizeSite,
    isAuthenticationUrl,
    isReadableUrl,
    parseInternalDomains,
    selectPagesToRead
  };
});
