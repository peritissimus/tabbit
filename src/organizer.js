(function initOrganizer(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.TabbitOrganizer = factory();
})(typeof self !== "undefined" ? self : this, function createOrganizer() {
  const TAB_GROUP_ID_NONE = -1;
  const URL_TRACKING_PARAMS = [
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "ref",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term"
  ];

  const COLORS = ["blue", "green", "yellow", "purple", "cyan", "orange", "pink", "grey"];
  const COLOR_SET = new Set(COLORS);

  const CATEGORY_RULES = [
    {
      title: "Local",
      color: "cyan",
      hosts: ["localhost", "127.0.0.1", "0.0.0.0"],
      keywords: ["local"]
    },
    {
      title: "Code",
      color: "purple",
      hosts: ["github.com", "gitlab.com", "bitbucket.org", "npmjs.com"],
      keywords: ["pull request", "merge request", "commit", "repository"]
    },
    {
      title: "Docs",
      color: "blue",
      hosts: [
        "developer.chrome.com",
        "developer.mozilla.org",
        "docs.github.com",
        "docs.npmjs.com",
        "readthedocs.io"
      ],
      keywords: ["documentation", "docs", "api reference", "guide"]
    },
    {
      title: "Search",
      color: "yellow",
      hosts: ["google.com", "bing.com", "duckduckgo.com", "perplexity.ai"],
      keywords: ["search"]
    },
    {
      title: "AI",
      color: "green",
      hosts: ["chatgpt.com", "claude.ai", "gemini.google.com", "poe.com"],
      keywords: ["chatgpt", "claude", "gemini"]
    },
    {
      title: "Work",
      color: "orange",
      hosts: [
        "linear.app",
        "notion.so",
        "slack.com",
        "gmail.com",
        "calendar.google.com",
        "drive.google.com",
        "figma.com",
        "jira.com",
        "atlassian.net"
      ],
      keywords: ["inbox", "calendar", "dashboard"]
    },
    {
      title: "Social",
      color: "pink",
      hosts: ["x.com", "twitter.com", "linkedin.com", "reddit.com", "news.ycombinator.com"],
      keywords: ["social"]
    },
    {
      title: "Media",
      color: "red",
      hosts: ["youtube.com", "netflix.com", "spotify.com", "twitch.tv", "vimeo.com"],
      keywords: ["video", "music", "playlist"]
    }
  ];

  function parseUrl(url) {
    try {
      return new URL(url);
    } catch (_error) {
      return null;
    }
  }

  function normalizeHost(hostname) {
    return String(hostname || "")
      .toLowerCase()
      .replace(/^www\./, "");
  }

  function hostMatches(host, expectedHost) {
    const cleanHost = normalizeHost(host);
    const cleanExpected = normalizeHost(expectedHost);
    return cleanHost === cleanExpected || cleanHost.endsWith(`.${cleanExpected}`);
  }

  function isSupportedTabUrl(url) {
    const parsed = parseUrl(url);
    if (!parsed) {
      return false;
    }

    return ["http:", "https:", "file:"].includes(parsed.protocol);
  }

  function isGroupableTab(tab, options = {}) {
    if (!tab || typeof tab.id !== "number") {
      return false;
    }

    if (tab.pinned && !options.includePinned) {
      return false;
    }

    return isSupportedTabUrl(tab.url);
  }

  function isLocalhostTab(tab) {
    const parsed = parseUrl(tab && tab.url);

    if (!parsed) {
      return false;
    }

    const host = normalizeHost(parsed.hostname);
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
  }

  function partitionLocalhostTabs(tabs, options) {
    const localhostTabs = [];
    const remainingTabs = [];

    for (const tab of tabs) {
      if (isGroupableTab(tab, options) && isLocalhostTab(tab)) {
        localhostTabs.push(tab);
      } else {
        remainingTabs.push(tab);
      }
    }

    return { localhostTabs, remainingTabs };
  }

  function buildLocalhostGroups(localhostTabs) {
    if (localhostTabs.length === 0) {
      return [];
    }

    const byWindow = new Map();

    for (const tab of localhostTabs) {
      if (!byWindow.has(tab.windowId)) {
        byWindow.set(tab.windowId, []);
      }

      byWindow.get(tab.windowId).push(tab);
    }

    return [...byWindow.entries()].map(([windowId, windowTabs]) => ({
      key: `${windowId}:Local`,
      title: "Local",
      color: "cyan",
      windowId,
      tabs: [...windowTabs].sort(compareTabsByWindowAndIndex),
      reasons: ["localhost"]
    }));
  }

  function startCase(input) {
    return String(input || "")
      .replace(/[-_.]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  function domainLabel(hostname) {
    const host = normalizeHost(hostname);
    const parts = host.split(".").filter(Boolean);

    if (parts.length === 0) {
      return "Other";
    }

    if (parts.length >= 3 && parts.at(-1).length === 2 && ["ac", "co", "com", "net", "org"].includes(parts.at(-2))) {
      return startCase(parts.at(-3));
    }

    if (parts.length >= 2) {
      return startCase(parts.at(-2));
    }

    return startCase(parts[0]);
  }

  function pickColorForString(value) {
    const input = String(value || "");
    let hash = 0;

    for (let index = 0; index < input.length; index += 1) {
      hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
    }

    return COLORS[hash % COLORS.length];
  }

  function sanitizeGroupTitle(title) {
    const cleaned = String(title || "Other").replace(/\s+/g, " ").trim();
    return cleaned.length > 24 ? `${cleaned.slice(0, 23).trim()}...` : cleaned;
  }

  function normalizeGroupColor(color) {
    const cleanColor = String(color || "").toLowerCase().trim();
    return COLOR_SET.has(cleanColor) ? cleanColor : "grey";
  }

  function categorizeTab(tab) {
    const parsed = parseUrl(tab.url);

    if (!parsed) {
      return { title: "Other", color: "grey", reason: "unknown" };
    }

    const host = normalizeHost(parsed.hostname);
    const searchableText = `${host} ${parsed.pathname} ${tab.title || ""}`.toLowerCase();

    for (const rule of CATEGORY_RULES) {
      const hasHostMatch = rule.hosts.some((ruleHost) => hostMatches(host, ruleHost));
      const hasKeywordMatch = rule.keywords.some((keyword) => searchableText.includes(keyword));

      if (hasHostMatch || hasKeywordMatch) {
        return {
          title: rule.title,
          color: rule.color,
          reason: hasHostMatch ? "host" : "keyword"
        };
      }
    }

    const label = domainLabel(host);
    return {
      title: label || "Other",
      color: pickColorForString(host),
      reason: "domain"
    };
  }

  function compareTabsByWindowAndIndex(left, right) {
    if (left.windowId !== right.windowId) {
      return left.windowId - right.windowId;
    }

    return left.index - right.index;
  }

  function buildGroupingPlan(tabs, options = {}) {
    const minGroupSize = Math.max(2, Number(options.minGroupSize || 2));
    const { localhostTabs, remainingTabs } = partitionLocalhostTabs(tabs, options);
    const localhostGroups = buildLocalhostGroups(localhostTabs);

    const buckets = new Map();
    const skippedTabs = [];
    const sortedTabs = [...remainingTabs].sort(compareTabsByWindowAndIndex);

    for (const tab of sortedTabs) {
      if (!isGroupableTab(tab, options)) {
        skippedTabs.push(tab);
        continue;
      }

      const category = categorizeTab(tab);
      const key = `${tab.windowId}:${category.title}`;

      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          title: sanitizeGroupTitle(category.title),
          color: category.color,
          windowId: tab.windowId,
          tabs: [],
          reasons: new Set()
        });
      }

      const bucket = buckets.get(key);
      bucket.tabs.push(tab);
      bucket.reasons.add(category.reason);
    }

    const regularGroups = [...buckets.values()]
      .filter((group) => group.tabs.length >= minGroupSize)
      .map((group) => ({
        ...group,
        reasons: [...group.reasons]
      }));

    const groups = [...localhostGroups, ...regularGroups].sort((left, right) => {
      const firstTabLeft = left.tabs[0];
      const firstTabRight = right.tabs[0];
      return compareTabsByWindowAndIndex(firstTabLeft, firstTabRight);
    });

    return {
      groups,
      skippedTabs,
      groupableCount: localhostTabs.length + (sortedTabs.length - skippedTabs.length),
      skippedCount: skippedTabs.length
    };
  }

  function buildGroupingPlanFromAiGroups(tabs, aiGroups, options = {}) {
    // We trust the AI's judgement on when to break a tab into its own group
    // (singletons), so we don't apply the minGroupSize floor here. The local
    // heuristic in buildGroupingPlan still enforces it because that path
    // categorizes by domain and would over-fragment otherwise.
    const { localhostTabs, remainingTabs } = partitionLocalhostTabs(tabs, options);
    const localhostTabIds = new Set(localhostTabs.map((tab) => tab.id));
    const localhostGroups = buildLocalhostGroups(localhostTabs);

    const groupableTabs = [...remainingTabs]
      .filter((tab) => isGroupableTab(tab, options))
      .sort(compareTabsByWindowAndIndex);
    const skippedTabs = remainingTabs.filter((tab) => !isGroupableTab(tab, options));
    const tabsById = new Map(groupableTabs.map((tab) => [tab.id, tab]));
    const assignedTabIds = new Set();
    const buckets = [];

    for (const aiGroup of Array.isArray(aiGroups) ? aiGroups : []) {
      const title = sanitizeGroupTitle(aiGroup?.title);
      const color = normalizeGroupColor(aiGroup?.color);
      const tabIds = Array.isArray(aiGroup?.tabIds) ? aiGroup.tabIds : [];
      const tabsByWindow = new Map();

      for (const tabId of tabIds) {
        if (localhostTabIds.has(tabId)) {
          continue;
        }

        const tab = tabsById.get(tabId);

        if (!tab || assignedTabIds.has(tab.id)) {
          continue;
        }

        assignedTabIds.add(tab.id);

        if (!tabsByWindow.has(tab.windowId)) {
          tabsByWindow.set(tab.windowId, []);
        }

        tabsByWindow.get(tab.windowId).push(tab);
      }

      for (const [windowId, windowTabs] of tabsByWindow.entries()) {
        buckets.push({
          key: `${windowId}:${title}:${buckets.length}`,
          title,
          color,
          windowId,
          tabs: windowTabs.sort(compareTabsByWindowAndIndex),
          reasons: ["groq"]
        });
      }
    }

    const aiOutputGroups = buckets.filter((group) => group.tabs.length >= 1);

    const groups = [...localhostGroups, ...aiOutputGroups].sort((left, right) => {
      const firstTabLeft = left.tabs[0];
      const firstTabRight = right.tabs[0];
      return compareTabsByWindowAndIndex(firstTabLeft, firstTabRight);
    });

    return {
      groups,
      skippedTabs,
      groupableCount: localhostTabs.length + groupableTabs.length,
      skippedCount: skippedTabs.length
    };
  }

  function normalizeUrlForDuplicate(url) {
    const parsed = parseUrl(url);

    if (!parsed || !["http:", "https:", "file:"].includes(parsed.protocol)) {
      return null;
    }

    parsed.hash = "";

    for (const param of URL_TRACKING_PARAMS) {
      parsed.searchParams.delete(param);
    }

    parsed.searchParams.sort();

    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }

    return parsed.toString();
  }

  function chooseDuplicateKeeper(tabs) {
    return [...tabs].sort((left, right) => {
      if (left.active !== right.active) {
        return left.active ? -1 : 1;
      }

      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1;
      }

      return compareTabsByWindowAndIndex(left, right);
    })[0];
  }

  function findDuplicateTabs(tabs, options = {}) {
    const buckets = new Map();

    for (const tab of tabs) {
      if (tab.pinned && !options.includePinned) {
        continue;
      }

      const normalizedUrl = normalizeUrlForDuplicate(tab.url);

      if (!normalizedUrl) {
        continue;
      }

      if (!buckets.has(normalizedUrl)) {
        buckets.set(normalizedUrl, []);
      }

      buckets.get(normalizedUrl).push(tab);
    }

    const duplicateSets = [...buckets.entries()]
      .filter(([, bucketTabs]) => bucketTabs.length > 1)
      .map(([url, bucketTabs]) => {
        const keeper = chooseDuplicateKeeper(bucketTabs);
        const removableTabs = bucketTabs.filter((tab) => tab.id !== keeper.id);

        return {
          url,
          keeper,
          removableTabs,
          tabs: bucketTabs
        };
      });

    return {
      duplicateSets,
      removableTabs: duplicateSets.flatMap((set) => set.removableTabs)
    };
  }

  return {
    TAB_GROUP_ID_NONE,
    buildGroupingPlanFromAiGroups,
    buildGroupingPlan,
    categorizeTab,
    findDuplicateTabs,
    isGroupableTab,
    isLocalhostTab,
    normalizeGroupColor,
    normalizeUrlForDuplicate,
    sanitizeGroupTitle
  };
});
