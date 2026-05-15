# Tabbit

A minimal Chrome extension that organizes your tabs into native Chrome tab groups using OpenAI. Built for developers who have AWS consoles, localhost dev servers, internal tools, and AI assistants all open at once.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue) ![No build step](https://img.shields.io/badge/build-none-green) ![Chrome 90+](https://img.shields.io/badge/Chrome-90%2B-yellow)

## What it does

- **Organize**: Groups all tabs in the current window using OpenAI. Reads tab titles + URLs, asks a GPT model to cluster them by theme, and applies the result as native Chrome tab groups.
- **Localhost is always its own group**: any `localhost`, `127.0.0.1`, or `0.0.0.0` tab becomes a guaranteed "Local" group — even if you only have one running.
- **Dedupe**: Closes exact-duplicate tabs (after stripping tracking params and URL fragments). Keeps the active or pinned tab from each duplicate set.
- **Ungroup**: Tears down all groups in the current window.
- **Save sessions**: Snapshots the current window's tabs to local storage; restore opens them in a new window. Up to 20 sessions retained.

## Install (unpacked)

1. Clone this repo.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** and select the repo root.
5. Pin Tabbit from the extensions menu.

## Setup

Tabbit needs an OpenAI API key. Get one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).

1. Click the Tabbit icon.
2. Paste your key into the `OpenAI API key` field. It autosaves locally (Chrome extension storage; never sent anywhere except OpenAI's API).
3. (Optional) Add a one-line **Context** describing your tab profile so the AI groups smarter. Example:
   ```
   dev at Acme. AWS/Datadog infra, localhost:* dev,
   *.acme.dev internal tools, Slack/Linear comms,
   ChatGPT/Claude assistants
   ```

## Configuration

| Field | Default | Purpose |
| --- | --- | --- |
| OpenAI API key | — | Required. Stored in `chrome.storage.local`. |
| Model | `gpt-5.5` | Any OpenAI chat model id. Set to `gpt-4o-mini` / `gpt-4.1-mini` for cheaper runs. |
| Context | — | Free-form text appended to the AI's system prompt to steer group naming. |

Defaults baked into the code (no UI controls): current window only, min group size 2, pinned tabs ignored, groups created uncollapsed.

## How AI grouping works

1. The popup queries `chrome.tabs.query({ currentWindow: true })`.
2. Localhost tabs are peeled off into a guaranteed "Local" group.
3. The rest are sent to OpenAI's chat completions endpoint with this shape:
   ```json
   { "minGroupSize": 2, "tabs": [{ "id", "title", "url", "windowId" }] }
   ```
   URLs are stripped of query strings and fragments before sending.
4. OpenAI returns `{ groups: [{ title, color, tabIds }] }` (JSON mode) which is validated and applied via `chrome.tabs.group()` + `chrome.tabGroups.update()`.

If the AI call fails or returns invalid JSON, Tabbit falls back to a built-in heuristic that groups by domain (GitHub → Code, MDN → Docs, slack/gmail/linear → Work, etc.). The localhost override applies in both paths.

## Privacy

- **Sent to OpenAI on each Organize**: tab IDs, tab titles, hostname + path (no query strings, no fragments), window ID, and your context line.
- **Never sent**: page content, your API key (it goes in the Authorization header to OpenAI only), session snapshots.
- **Stored locally**: API key, model, context string, saved sessions. All in `chrome.storage.local`.

## Development

```bash
npm test          # run organizer unit tests
npm run check     # syntax-check JS files
npm run validate  # parse manifest.json + check + test
```

The codebase is plain Manifest V3 — no bundler, no transpilation, no dependencies. Files of interest:

| File | Role |
| --- | --- |
| `src/popup.html` | Popup markup. |
| `src/popup.css` | Dark minimal styling. |
| `src/popup.js` | Popup controller: state, settings persistence, OpenAI API call, Chrome API calls. |
| `src/organizer.js` | Pure functions: grouping plans, localhost extraction, duplicate detection, URL normalization. Importable in Node for tests. |
| `tests/organizer.test.js` | Node `test:node` suite covering the organizer. |

## Permissions

| Permission | Used for |
| --- | --- |
| `tabs` | Read titles/URLs of open tabs. |
| `tabGroups` | Create and update native tab groups. |
| `storage` | Persist API key, model, context, sessions. |
| host: `https://api.openai.com/*` | Send grouping requests to OpenAI. |

## License

MIT. See `LICENSE` if present, otherwise treat as MIT.
