(function initSettings(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TabbitNewtabSettings = factory();
  }
})(typeof self !== "undefined" ? self : this, function createSettings() {
  const MAX_SHORTCUTS = 8;
  const DEFAULT_SHORTCUTS = [
    { label: "AWS", url: "https://d-9067d10406.awsapps.com/start/#/" },
    { label: "Mononest", url: "https://github.com/zoca-ai/mononest" },
    { label: "Slack", url: "https://app.slack.com/client/T07Q3QDF679" },
    { label: "Linear", url: "https://linear.app/zoca" },
    { label: "Zoca Sandbox", url: "https://app.mononest.dev/dashboard" },
    { label: "Raft", url: "https://raft.zoca.ai/" },
    { label: "Zoca Multilocation", url: "https://app-multilocation.zoca-tech.com/dashboard" },
    { label: "AWS Console", url: "https://us-east-1.console.aws.amazon.com/console/home?region=us-east-1" }
  ];

  function validateShortcuts(value) {
    if (!Array.isArray(value) || value.length > MAX_SHORTCUTS) {
      throw new Error(`Choose up to ${MAX_SHORTCUTS} shortcuts.`);
    }
    const seen = new Set();
    return value.map((item, index) => {
      const label = typeof item?.label === "string" ? item.label.trim() : "";
      if (!label || label.length > 32) {
        throw new Error(`Shortcut ${index + 1}: use a name between 1 and 32 characters.`);
      }
      let url;
      try {
        url = new URL(item.url);
      } catch (_error) {
        throw new Error(`Shortcut ${index + 1}: enter a full URL, starting with https:// or http://.`);
      }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new Error(`Shortcut ${index + 1}: use an HTTP or HTTPS URL without embedded credentials.`);
      }
      if (seen.has(url.href)) {
        throw new Error(`Shortcut ${index + 1}: this URL is already in your shortcuts.`);
      }
      seen.add(url.href);
      return { label, url: url.href };
    });
  }

  function readShortcuts(value) {
    try {
      return validateShortcuts(value);
    } catch (_error) {
      return DEFAULT_SHORTCUTS.map((item) => ({ ...item }));
    }
  }

  return { MAX_SHORTCUTS, DEFAULT_SHORTCUTS, readShortcuts, validateShortcuts };
});
