"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else /** @type {any} */ (root).createTabbitAiTransport = factory;
})(
  typeof self !== "undefined" ? self : this,
  function ({ chrome, fetch, config }) {
    const { CODEX_HOST, buildJsonRequest, buildCodexRequest } = config;
    const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
    const CODEX_TIMEOUT_MS = 5 * 60 * 1000;
    // Asks the local Codex CLI through the native messaging host, which uses the
    // ChatGPT sign-in instead of an API key. The open port keeps the worker alive.
    function requestCodexJson(messages, settings, task, timeoutMs = null) {
      return new Promise((resolve, reject) => {
        const port = chrome.runtime.connectNative(CODEX_HOST);
        let settled = false;

        const finish = (settle, value) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);

          try {
            port.disconnect();
          } catch (_error) {
            // Already closed.
          }

          settle(value);
        };

        const timer = setTimeout(
          () => finish(reject, new Error("Codex took too long to answer")),
          timeoutMs || CODEX_TIMEOUT_MS,
        );

        port.onMessage.addListener((reply) => {
          if (!reply?.ok) {
            finish(reject, new Error(reply?.error || "Codex request failed"));
            return;
          }

          try {
            finish(resolve, parseAiJsonContent(reply.content));
          } catch (error) {
            finish(reject, error);
          }
        });

        port.onDisconnect.addListener(() => {
          const message = chrome.runtime.lastError?.message || "";
          finish(
            reject,
            new Error(
              /not found|forbidden/i.test(message)
                ? "Codex bridge is not installed. Run `npm run install-codex-host` in the Tabbit folder, then reload the extension."
                : message || "Codex bridge closed before answering",
            ),
          );
        });

        try {
          port.postMessage(buildCodexRequest(messages, settings, task));
        } catch (error) {
          // A port can close between connection and sending. Release its timer
          // and connection just as we do for asynchronous disconnects.
          finish(reject, error);
        }
      });
    }

    // Streamed so the response starts arriving at once: a service worker is
    // stopped if a fetch stays silent for 30 seconds.
    /**
     * @param {import("../types/contracts").ChatMessage[]} messages
     * @param {import("../types/contracts").AiSettings} settings
     * @param {import("../types/contracts").AiTask} task
     * @param {number|null} timeoutMs
     */
    async function requestJson(
      messages,
      settings,
      task = "selection",
      timeoutMs = null,
    ) {
      if (settings.provider === "codex") {
        return requestCodexJson(messages, settings, task, timeoutMs);
      }

      const response = await fetch(OPENAI_API_URL, {
        ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...buildJsonRequest(messages, settings, task),
          stream: true,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.error?.message ||
            `OpenAI request failed with HTTP ${response.status}`,
        );
      }

      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";
      let content = "";

      for (;;) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          const data = line.startsWith("data:") ? line.slice(5).trim() : "";

          if (data && data !== "[DONE]") {
            content += JSON.parse(data).choices?.[0]?.delta?.content || "";
          }
        }
      }

      if (!content.trim()) {
        throw new Error("AI returned an empty response");
      }

      return JSON.parse(content);
    }

    function parseAiJsonContent(content) {
      const trimmed = String(content || "").trim();

      if (!trimmed) {
        throw new Error("AI returned an empty response");
      }

      try {
        return JSON.parse(trimmed);
      } catch (_error) {
        const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          throw new Error("AI did not return JSON");
        }

        return JSON.parse(jsonMatch[0]);
      }
    }

    async function requestGrouping(messages, settings, debug) {
      const requestBody = buildJsonRequest(messages, settings, "grouping");
      if (settings.provider === "codex") {
        debug.parsed = await requestCodexJson(
          requestBody.messages,
          settings,
          "grouping",
        );
      } else {
        const response = await fetch(OPENAI_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        debug.response = await response.json().catch(() => ({}));
        debug.status = response.status;

        if (!response.ok || debug.response.error) {
          throw new Error(
            debug.response.error?.message ||
              `OpenAI request failed with HTTP ${response.status}`,
          );
        }

        debug.rawContent = debug.response.choices?.[0]?.message?.content;
        debug.parsed = parseAiJsonContent(debug.rawContent);
      }

      return debug.parsed;
    }

    return { requestJson, requestCodexJson, requestGrouping };
  },
);
