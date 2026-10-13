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
| AI access | OpenAI API key | `OpenAI API key` calls the API directly. `Codex subscription` and `Claude subscription` use their signed-in local CLIs (see below). |
| OpenAI API key | — | Required for API-key access. Stored in `chrome.storage.local`. |
| Grouping & page selection | `gpt-6-luna` | Groups tabs and picks pages for the brief, with low reasoning effort. |
| Brief model | `gpt-6.1-sol` | Synthesizes the scraped pages into the brief, with medium reasoning effort. |
| Context | — | Free-form text appended to the AI's system prompt to steer group naming. Wildcard domains in it (`*.acme.dev`) also define the new tab's Internal bucket. |

Defaults baked into the code (no UI controls): current window only, min group size 2, pinned tabs ignored, groups created uncollapsed.

Legacy single-model settings automatically adopt Luna and Sol while preserving your API key and context. You can then change either model independently. Cached briefs and grouping plans remain until their normal refresh or an explicit rebuild.

## Using a Codex subscription instead of an API key

A ChatGPT/Codex subscription has no API key, so Tabbit reaches it through the `codex` CLI on your computer:

1. Install the Codex CLI and sign in with `codex login`.
2. Run `npm run install-codex-host` in this folder. It registers a native messaging host (`dev.tabbit.codex`) for Chrome, Chrome Canary and Chromium, pinned to this folder's extension id and your current `node` and `codex` paths. Re-run it if either path changes; pass `--id <extension id>` if the extension is not loaded unpacked from this folder, and `--uninstall` to remove it.
3. Reload Tabbit in `chrome://extensions` and set **AI access** to **Codex subscription** in the popup or the new tab's **Settings** dialog.

Each request then runs `codex exec` in an empty temporary directory with the read-only sandbox, no session history and your Codex config and rules ignored, using the same two model fields. Expect roughly ten seconds and a few thousand tokens of overhead per call, counted against your Codex usage limits. Page text is passed to Codex as data with an instruction not to act on it, but Codex is an agent with shell access inside that sandbox, so this is a wider surface than a plain API call.

`npm run validate` includes simulated native-port tests for brief and feed builds: repeated new-tab wake events preserve the active request, completed editions stay cached, and failed sends release the connection. These tests use fixture browser reads and Codex replies, not a live browser or subscription. For the live check, start each build with Codex selected, close and reopen the new tab during generation, and verify it finishes without restarting and stays unchanged on another reopen.

## Using a Claude subscription

1. Install a current [Claude Code CLI](https://code.claude.com/docs/en/overview) and sign in with `claude auth login`. Confirm `claude auth status` reports a Claude subscription login.
2. Run `npm run install-claude-host` in the Tabbit folder. Optional: `-- --id <extension-id> --claude /absolute/path/to/claude`. The installer supports macOS and Linux Chrome/Chromium, like the Codex bridge; Windows is not supported.
3. Reload Tabbit and choose **Claude subscription** in either Settings screen. No API key is needed.

Grouping and page selection default to `sonnet`; brief and feed writing default to `opus`. These aliases follow the CLI's current model versions. You can override them. Claude model choices are saved separately from the shared Codex/OpenAI model choices; switching providers preserves both and your existing API key.

The native host runs `claude -p` with JSON output, tools disabled, safe mode, no custom MCP servers, no session persistence, and an empty temporary directory. It retains local CLI authentication while removing inherited API-key and alternate-provider environment overrides. It does not extract tokens or call unofficial APIs. This requires a recent CLI supporting `--safe-mode`; update Claude Code if it reports an unknown option. Requests time out after five minutes; disconnecting the native port terminates the CLI. Brief/feed progress and results use the same persistent background workflow as the other providers.

Anthropic currently permits `claude -p` and third-party app usage against subscription limits ([official policy](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), checked October 13, 2026). Selected page text, titles and URLs are sent to Claude for generation. Your plan's limits and model availability still apply. To remove only this bridge, run `npm run install-claude-host -- --uninstall`.

Validation includes both providers' native-port lifecycle tests, model preservation, Claude CLI errors/timeouts and a synthetic signed-in Claude request. Browser settings checks use a local fixture; they do not establish live Chrome extension behavior.

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

## Personalized discovery feed

**Worth discovering** keeps the existing work layout and shows four picks at a time: official AI-lab announcements, news and products, with more behind **More picks**. **AI labs**, **News** and **Products** filter the saved edition. **Build feed** starts the first edition; **Refresh** explicitly rebuilds it.

The worker summarizes the last 14 days of browsing on supported developer/news domains (domain, up to four titles, visits), then the selection model chooses from curated news and publisher surfaces. HN and Show HN use the public API for current links, submission timestamps, points and comments. Other selected sites (including Product Hunt, Techmeme and official announcement blogs) are read in the signed-in browser, up to fourteen sources total, including official channels for all six AI labs (OpenAI, Anthropic, Google DeepMind, Meta AI, xAI and Mistral). Google coverage also always includes Google Developers Blog and Google AI Announcements, where Gemma and developer-facing releases may appear. Meta coverage uses the current `research.meta.ai` site, including Muse announcements. Unreadable or redirected sources are listed in **Sources**. Product Hunt uses its browser page; it does not use the licensed Product Hunt API.

The writing model curates up to sixteen evidence-backed news/product items. Items are then ranked by practical impact: capability change, relevance to your work, actionability and broader consequences. Recent significant announcements take priority: impact keeps its full weight for the first 48 hours, then is multiplied by `1 / (1 + (ageDays - 2) / 3)`. Undated items receive 60% weight, rather than being assumed fresh. This lets a major older release still outrank a fresh minor update. Dates and engagement break remaining ties. High-impact badges describe the underlying impact estimate, not the freshness-adjusted position. Existing saved editions take on the new ranking after **Refresh**. Fixed lab/news/product quotas no longer override the four visible picks. High-impact labels require a supporting quote from the individual item context; unsupported/title-only estimates are discounted. “Why it matters” explains the consequence. These remain editorial estimates, not measured or independently verified impact. URLs must come from links actually retrieved. HN dates are submission dates, not verified first-launch dates; undated browser links show **Date not provided**. Structured items older than seven days (news) or fourteen days (products) are rejected. Model editorial judgments about relevance, novelty and summaries still need user judgment.

Independent page reads run concurrently: publisher pages load alongside HN requests, already-open brief pages are read together, and each HN source keeps at most five story requests active. Models, content limits, and source coverage are unchanged. Brief/feed processing shows a spinner and first-build placeholders, respects reduced-motion preferences, and keeps saved content visible during refresh.

After each build, expand **Built in …** beneath the brief or feed to see wall-clock timings for selection, source reading, and writing/curation, plus the longest stage. Brief timings also include browser history. Measurements persist across tab closes, report failed attempts too, and cover the latest attempt only. Older cached builds have no timings until rebuilt.

Thumbs up/down are saved locally, toggle off when clicked again, and feed the next source-selection and curation prompts. A downvoted URL is excluded from future editions; one vote does not ban an entire source. **Tune feed** saves instructions and an automatic-refresh toggle. After the first successful edition, refresh runs every six hours while Chrome is running. Failed attempts back off, an interrupted build restarts once, and closing a new tab never discards an edition or starts a fresh build by itself.

## Privacy

- **Sent to OpenAI on each Organize**: tab IDs, tab titles, hostname + path (no query strings, no fragments), window ID, and your context line.
- **Sent to OpenAI on each Brief build**: titles and hostname + path of up to 60 pages (open tabs first, then your top pages from the last 14 days of history), visit counts, your context line, and the visible text and links of the up to 8 pages it reads. Those pages are read signed in as you, so they can include private content. Nothing is sent until you click **Build** for the first time.
- **Sent to OpenAI on each Discovery build**: the supported-domain browsing summary, feed instructions, up to 40 rated examples, and text/links from the selected news/product sources. The API key is used only for OpenAI authentication. Internal wildcard domains, local addresses, unsupported sites and authentication hops are excluded from the discovery profile.
- **Never sent**: page content outside a Brief or Discovery build, your API key (it goes in the Authorization header to OpenAI only), session snapshots.
- **Stored locally**: API key, model, context string, saved sessions, the latest brief, discovery edition/progress, feed instructions and up to 200 feedback records. All in `chrome.storage.local`.

## Development

```bash
npm test          # run organizer unit tests
npm run check     # syntax-check JS files
npm run validate  # parse manifest.json + check + test
```

The codebase is plain Manifest V3 — no bundler, no transpilation, and no runtime dependencies. TypeScript is a development-only checker for the extracted JavaScript modules; install it with `npm ci`. `npm run validate` checks every shipped script, runs `tsc` with `checkJs`, and runs the Node regression suite. Chrome/native API boundaries remain loosely typed; this is incremental checking, not full-project strict typing. Files of interest:

| File | Role |
| --- | --- |
| `src/popup.html` | Popup markup. |
| `src/popup.css` | Dark minimal styling. |
| `src/popup.js` | Popup state, tab actions, grouping previews and sessions; settings UI lives in `popup-settings-view.js`. AI calls run in the worker. |
| `src/organizer.js` | Pure functions: grouping plans, localhost extraction, duplicate detection, URL normalization. Importable in Node for tests. |
| `src/newtab.html`, `src/newtab.css` | New-tab markup and styling. |
| `src/newtab.js` | New-tab composition, shared state, tab/history snapshots, directory rendering and event routing. |
| `src/background.js` | Composition root: wires adapters/workflows and routes Chrome messages, startup events and alarms. |
| `src/contracts.js`, `types/contracts.d.ts` | Stable storage/message names and JSDoc data contracts; existing persisted values are unchanged. |
| `src/storage.js`, `src/build-lifecycle.js` | Settings migration/storage access and shared single-flight build state with persisted timing. |
| `src/ai-transport.js` | OpenAI streaming/grouping and native Codex/Claude transport; injected platform and network adapters. |
| `src/page-reader.js`, `src/community-reader.js` | Browser extraction/window cleanup and bounded HN request concurrency. |
| `src/brief-workflow.js`, `src/feed-workflow.js`, `src/grouping-workflow.js` | Feature prompts, orchestration, result validation, scheduling/recovery policies. |
| `src/newtab-*-view.js`, `src/popup-settings-view.js` | Feature controllers for settings, shortcuts, brief, local servers and search. Dependencies are supplied at creation. |
| `src/workspace.js` | Pure functions: history ranking, site categories, local server detection, page-reading rules, brief validation. Importable in Node for tests. |
| `src/discovery.js` | Pure discovery source selection, browsing profile, evidence validation and feedback helpers. |
| `src/discovery-view.js` | Compact discovery feed, filters, feedback and instructions UI. |
| `native-host/{codex,claude}-host.js` | CLI-specific runners; `protocol.js` shares native framing and connection lifecycle. |
| `scripts/install-codex-host.js` | Registers that host with Chrome. |
| `tests/*.test.js` | Node `node:test` suites covering the organizer and workspace modules. |

Modules expose factories through browser namespaces and CommonJS for tests. The worker owns build lifetimes; views only send messages and observe storage. Workflows depend on injected readers/transport/storage, while pure ranking and validation modules remain platform-independent. Worker integration tests run the entrypoint in a VM with Chrome adapters; focused module tests import factories directly. Tests no longer slice function bodies out of source files. Browser preview checks use fixtures and do not establish live extension/native-host behavior.

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
| `nativeMessaging` | Talk to the selected local Codex or Claude CLI for subscription access. |
| host: `<all_urls>` | Read pages for the brief, call OpenAI, and check which local dev servers are up. |

## License

MIT. See `LICENSE` if present, otherwise treat as MIT.
