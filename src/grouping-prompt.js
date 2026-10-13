(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./organizer"));
  else root.TabbitGroupingPrompt = factory(root.TabbitOrganizer);
})(typeof self !== "undefined" ? self : this, function (organizer) {
  function safeUrlForAi(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      parsed.search = "";
      return parsed.toString();
    } catch (_error) {
      return String(url || "").slice(0, 300);
    }
  }

  function safeText(value, maxLength) {
    const cleaned = String(value || "")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.length > maxLength
      ? `${cleaned.slice(0, maxLength - 3).trim()}...`
      : cleaned;
  }

  function buildAiMessages(tabs, options, settings) {
    const aiTabs = tabs
      .filter((tab) => organizer.isGroupableTab(tab, options))
      .map((tab) => ({
        id: tab.id,
        title: safeText(tab.title || "", 160),
        url: safeUrlForAi(tab.url),
        windowId: tab.windowId,
      }));

    const userContext = String(settings?.context || "").trim();

    const systemLines = [
      "You organize Chrome tabs into useful native tab groups.",
      "Return only a valid JSON object.",
      'Use this exact shape: {"groups":[{"title":"short name","color":"blue","tabIds":[1,2]}]}.',
      `Allowed colors: ${["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"].join(", ")}.`,
      "Use only tab IDs from the input. Put each tab ID in at most one group.",
      "Keep titles under 24 characters. One or two words is ideal.",
      "Create as many cohesive groups as you can — prefer many specific groups over a few broad buckets.",
      "Any 2+ tabs sharing a clear theme should form a group; do not force unrelated tabs together.",
      "Do NOT include localhost / 127.0.0.1 / 0.0.0.0 tabs in any group — they are handled separately and must not appear in your output.",
      "Recognize developer patterns: group cloud consoles and monitoring tools (AWS, GCP, Datadog, Grafana, Sentry, CloudWatch) as 'Infra'; group internal company subdomains (any private/non-public domain a user mentions) under that company's name.",
      "Distinguish AI assistants you talk to (ChatGPT, Claude, Gemini, Perplexity) from AI products/dashboards you build with (Retell AI, Vapi, ElevenLabs, OpenAI platform): treat the latter as work tools belonging with the user's company / project group, not as assistants.",
      "Combine AI assistants and general web search into 'AI & Search' only when each has too few tabs to stand alone.",
      "Combine comms tools (Slack, Gmail, Linear, Notion, Discord) into 'Comms' or 'Work' unless one cluster dominates.",
    ];

    if (userContext) {
      systemLines.push(
        `User context (use to inform group titles and patterns): ${userContext}`,
      );
    }

    return [
      { role: "system", content: systemLines.join(" ") },
      {
        role: "user",
        content: JSON.stringify({
          minGroupSize: options.minGroupSize,
          tabs: aiTabs,
        }),
      },
    ];
  }

  return { buildAiMessages };
});
