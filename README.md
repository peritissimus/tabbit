# Tabbit

Tabbit is an unpacked Chrome extension for cleaning up tab overload with native Chrome tab groups.

## Features

- Organize tabs into native named and colored Chrome tab groups.
- Optionally ask Groq for an AI-generated grouping plan.
- Close exact duplicate tabs after stripping common tracking params and URL fragments.
- Ungroup tabs in the current window or across all windows.
- Save and restore local tab sessions.
- Keep deterministic grouping local. Groq is used only when you enable AI mode or click `Ask Groq`.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `/Users/peritissimus/projects/tabbit`.
5. Pin `Tabbit` from the Chrome extensions menu.

## Development

```bash
npm test
npm run validate
```

The extension is plain Manifest V3 JavaScript, HTML, and CSS. It intentionally has no build step.

## Groq AI grouping

Tabbit uses Groq's OpenAI-compatible chat completions endpoint:

```text
https://api.groq.com/openai/v1/chat/completions
```

The default model prioritizes grouping quality:

```text
openai/gpt-oss-120b
```

For faster or cheaper grouping, set the model field to `meta-llama/llama-4-scout-17b-16e-instruct` or `openai/gpt-oss-20b`.

Paste a `GROQ_API_KEY` value into the popup and click `Save key`. The key is stored in Chrome extension local storage. When AI grouping is used, Tabbit sends tab IDs, titles, window IDs, and URLs with query strings/fragments stripped.

## Notes

Deterministic local heuristics remain the fallback if Groq is disabled or the API request fails.
