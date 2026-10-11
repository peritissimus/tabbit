# Tabbit

A minimal Chrome extension that organizes your tabs into native Chrome tab groups using OpenAI. Built for developers who have AWS consoles, localhost dev servers, internal tools, and AI assistants all open at once.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue) ![No build step](https://img.shields.io/badge/build-none-green) ![Chrome 121+](https://img.shields.io/badge/Chrome-121%2B-yellow)

## What it does

- **Organize**: Groups all tabs in the current window using OpenAI. Reads tab titles + URLs, asks a GPT model to cluster them by theme, and applies the result as native Chrome tab groups.
- **Localhost is always its own group**: any `localhost`, `127.0.0.1`, or `0.0.0.0` tab becomes a guaranteed "Local" group — even if you only have one running.
- **Dedupe**: Closes exact-duplicate tabs (after stripping tracking params and URL fragments). Keeps the active or pinned tab from each duplicate set.
- **Clean up**: Closes tabs that have not been accessed for 7 days. Active, pinned, audible, and tabs without access history are protected.
- **Ungroup**: Tears down all groups in the current window.
- **Save sessions**: Snapshots the current window's tabs to local storage; restore opens them in a new window. Up to 20 sessions retained.
- **New tab**: Replaces Chrome's new-tab page with a work dashboard built from your open tabs and recent history. See [New tab](#new-tab).

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

If Chrome asks whether to keep the changed new-tab page, choose **Keep it**.

## New tab

Every new tab opens on a compact launch page. Everything except the Brief is computed locally.

- **Shortcuts**: A fixed row of up to eight named destinations. AWS access and Mononest come first by default. Use **Edit shortcuts** to rename, reorder, add or remove links; Save stores the row locally across tabs and browser restarts. Cancel leaves the saved row unchanged. Suggestions live in the editor and never reshuffle your shortcuts.
- **At a glance**: The first attention item from the saved brief is a direct link. Expand **View brief** for the full summary and work threads. The brief is an optional AI summary of what needs your attention and the work threads you have in flight. Click **Build** once; after that it rebuilds itself in the background when it is more than 6 hours old. See [How the brief is built](#how-the-brief-is-built).
- **Dev servers**: Reachable servers appear first. Offline or unchecked servers stay under **Other servers** with neutral status indicators.
- **Open tabs** (collapsed by default): Your tab groups across all windows. Clicking a tab switches to it and closes the new tab.
- **All work links** (collapsed by default): Your most-used sites from the last 14 days, bucketed as Internal, Infra, Code, Comms, AI, Docs, and Other. Any wildcard in the **Context** field (`*.acme.dev`) is treated as an Internal domain.
- **Sessions**: Saved sessions, with one-click restore.

The search box filters open tabs and recent pages (`/` to focus, arrows to pick, Enter to open). With no match, Enter opens a URL or searches with your default search engine.

### How the brief is built

The build runs in the extension's background service worker, not in the new-tab page. You can close the tab mid-build: progress is stored, every new tab shows the same live build, and an interrupted build is restarted once automatically.

1. Rank your open tabs and the last 14 days of history into up to 60 candidate pages.
2. Ask OpenAI which of them (up to 8) are worth reading: PR lists, ticket inboxes, CI runs, dashboards.
3. Read those pages in your signed-in browser. Pages already open are read in place; the rest load in a minimized window that is closed afterwards. Webmail, banking-like hosts, and URLs that look like actions (logout, delete, confirm) are never opened.
4. Send the page text (up to 6,000 characters and 40 links per page) to OpenAI and get back a headline, a **Needs attention** list, and work threads. The model refers to pages and links by id, so it cannot invent a URL. Pages that could not be read are listed under the brief.

## Configuration

| Field | Default | Purpose |
| --- | --- | --- |
| OpenAI API key | — | Required. Stored in `chrome.storage.local`. |
| Grouping & page selection | `gpt-6-luna` | Groups tabs and picks pages for the brief, with low reasoning effort. |
| Brief model | `gpt-6.1-sol` | Synthesizes the scraped pages into the brief, with medium reasoning effort. |
| Context | — | Free-form text appended to the AI's system prompt to steer group naming. Wildcard domains in it (`*.acme.dev`) also define the new tab's Internal bucket. |

Defaults baked into the code (no UI controls): current window only, min group size 2, pinned tabs ignored, groups created uncollapsed.

Legacy single-model settings automatically adopt Luna and Sol while preserving your API key and context. You can then change either model independently. Cached briefs and grouping plans remain until their normal refresh or an explicit rebuild.

## How AI grouping works

1. The popup queries `chrome.tabs.query({ currentWindow: true })`.
2. Localhost tabs are peeled off into a guaranteed "Local" group.
3. The rest are sent to OpenAI's chat completions endpoint with this shape:
   ```json
   { "minGroupSize": 2, "tabs": [{ "id", "title", "url", "windowId" }] }
   ```
   URLs are stripped of query strings and fragments before sending.
4. OpenAI returns `{ groups: [{ title, color, tabIds }] }` (JSON mode) which is validated and applied via `chrome.tabs.group()` + `chrome.tabGroups.update()`.

The request runs in the background worker and the plan is stored, so reopening the popup shows the last plan instead of asking again (even if the popup closed mid-request). Tabbit only asks OpenAI when you click **Organize**, **Reorganize**, or **Refresh**; tabs opened since the last plan show as `AI plan · N new`, and Organize then fetches a fresh plan.

If the AI call fails or returns invalid JSON, Tabbit falls back to a built-in heuristic that groups by domain (GitHub → Code, MDN → Docs, slack/gmail/linear → Work, etc.). The localhost override applies in both paths.

## Privacy

- **Sent to OpenAI on each Organize**: tab IDs, tab titles, hostname + path (no query strings, no fragments), window ID, and your context line.
- **Sent to OpenAI on each Brief build**: titles and hostname + path of up to 60 pages (open tabs first, then your top pages from the last 14 days of history), visit counts, your context line, and the visible text and links of the up to 8 pages it reads. Those pages are read signed in as you, so they can include private content. Nothing is sent until you click **Build** for the first time.
- **Never sent**: page content outside a Brief build, your API key (it goes in the Authorization header to OpenAI only), session snapshots.
- **Stored locally**: API key, model, context string, saved sessions, the latest brief. All in `chrome.storage.local`.

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
| `src/newtab.html`, `src/newtab.css` | New-tab markup and styling. |
| `src/newtab.js` | New-tab controller: reads tabs and history, renders the dashboard and the stored brief, probes local servers. |
| `src/background.js` | Service worker: builds the brief (page picking, reading, OpenAI calls), stores progress, resumes and schedules builds. |
| `src/workspace.js` | Pure functions: history ranking, site categories, local server detection, page-reading rules, brief validation. Importable in Node for tests. |
| `tests/*.test.js` | Node `node:test` suites covering the organizer and workspace modules. |

## Permissions

| Permission | Used for |
| --- | --- |
| `tabs` | Read titles/URLs of open tabs. |
| `tabGroups` | Create and update native tab groups. |
| `storage` | Persist API key, model, context, sessions, brief. |
| `history` | Rank recent sites and local servers for the new tab. |
| `favicon` | Show site icons on the new tab. |
| `search` | Send new-tab searches to your default search engine. |
| `scripting` | Read the text of the pages chosen for the brief. |
| `alarms` | Refresh a stale brief and restart an interrupted build. |
| host: `<all_urls>` | Read pages for the brief, call OpenAI, and check which local dev servers are up. |

## License

MIT. See `LICENSE` if present, otherwise treat as MIT.
