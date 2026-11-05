# Agent conventions for this repo

This file is for any coding agent (human-directed or automated) working on Styleprint.

## publik API
- Base URL: https://publikhq.com/api/v1 (OpenAI Chat Completions, Responses, Anthropic Messages)
- Models: publik-fast, publik-balanced, publik-smart only; never a vendor model name
- Key: per-install `pk_` from POST /installs, stored at the publik credential path; env PUBLIK_API_KEY / PUBLIK_API_BASE_URL override
- App token: publik-app-token.txt (public by design, committed) or PUBLIK_APP_TOKEN
- 402: show error.message plus error.top_up_url only
- Never print or log a key
- Docs: https://publikhq.com/llms.txt, https://publikhq.com/developers, https://publikhq.com/skills/api.md

Listed at https://publikhq.com/styleprint (slug `styleprint`). Products enabled:
`ai.chat`, `ai.embeddings`.

**Setup prompt** (from publik's developer page, for a coding agent adding publik to a
new surface in this app):

```
Add publik API to my app (publik slug: styleprint): ask for a tier slug (publik-fast/balanced/smart), pick the cheapest one the task needs, and write the publik log line. Fetch https://publikhq.com/skills/api.md with curl and follow it step by step.
```

**Client-selection order**, enforced by `server/src/ai/client.ts` and never bypassed:

1. The user's own key + base URL (from the credential file's `userKey`/`userBaseUrl`).
2. `PUBLIK_API_KEY` / `PUBLIK_API_BASE_URL` environment variables.
3. The per-install credential file's `installKey` (minted via `POST /installs` from the
   public `publik-app-token.txt`, using `provision()` in `server/src/ai/client.ts`).
4. None of the above: the UI asks the user for their own key, or to run first-run
   provisioning.

**Builder self-test**: `PUBLIK_SELF_TEST=1 "<built binary>"` prints `publik self-test:
ok styleprint <version> (install <id>)` or a `failed: <message>` line, then exits — see
`selfTest()` in `server/src/ai/client.ts` and https://publikhq.com/skills/setup.md.

**Rules for any new AI call in this repo:**

- Ask for a tier (`publik-fast` / `publik-balanced` / `publik-smart`), never a vendor
  model name. publik swaps the backing model without the app needing to change.
- Every call goes through `chatCompletion()` or `createEmbeddings()` in
  `server/src/ai/client.ts` — never construct a second OpenAI client elsewhere.
- Capture `x-publik-*` response headers via `extractUsageHeaders` and record a `spend`
  row (`server/src/db/repo.ts: createSpend`) for anything that isn't a one-off dry run.
- On a `402`, surface only `error.message` and `error.top_up_url` to the user — nothing
  else from the response body.
- `STYLEPRINT_MOCK=1` must make the call deterministic and keep working with no key and
  no network. Add new deterministic behaviour to `server/src/ai/mock.ts` by `kind`,
  never by inlining mock logic at the call site.

## Prompts

Every prompt the app sends lives in `prompts/*.md` as a versioned file (filename ends
`.v<N>.md`), loaded at runtime by `server/src/pipeline/prompts.ts`. Never inline a
prompt string in code — add or edit a file in `prompts/` and bump its version suffix
if the wording changes in a way that would make old `decisions.jsonl`/test fixtures
behave differently.

## Tests and gates

Each server module has a dedicated `npm run test:<name>` script (see root
`package.json`) and a Vitest file under `server/tests/`. `npm run check` runs every
gate in sequence — run it before considering a change done. The frontend has one
Playwright smoke test (`web/e2e/smoke.spec.ts`) that walks the full user journey in
mock mode; update it when a screen's `data-testid` attributes change.

## Desktop build (src-tauri/)

`npm run desktop:build` bundles the server (`server/scripts/bundle-desktop.mjs`,
esbuild → single ESM file) and runs `tauri build` to produce Windows installers. The
Rust shell (`src-tauri/src/main.rs`) does not reimplement any app logic — it spawns
the bundled server and points a window at it. If you change how `server/src` resolves
its own file locations (prompts/, the web build, the app token — all computed from
`import.meta.url`), re-run `npm run bundle:desktop -w server` and smoke-test the
`.exe` directly before assuming it still works; a green `tsc`/`vitest` run does not
exercise the bundled/packaged code path. See `DECISIONS.md` #31-37.

macOS builds happen only in CI (`.github/workflows/desktop-release.yml`, triggered by
a `v*.*.*` tag or manual dispatch) — there's no Mac in this project's local build
environment, so changes to `src-tauri/` that might affect macOS need verification via
that workflow's logs, not just a local Windows build.

## Data and privacy

Nothing in `~/.styleprint/` (or `$STYLEPRINT_HOME` when set) should ever be logged,
printed, or committed. A `pk_` key must never enter the repo — `publik-app-token.txt`
is the only credential-shaped file that is intentionally committed, and it holds the
public `pat_` app token, not a live key.
