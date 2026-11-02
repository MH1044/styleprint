# Decisions

One line each, in build order, for every place the spec was silent or the one-shot
build plan needed a concrete choice.

1. **Repo root has no Rust/Tauri shell.** Monorepo is `shared/`, `server/`, `web/` npm
   workspaces, matching the one-shot build plan's Node+Express+Vite substitution.
2. **TypeScript pinned to 5.9.3, not the current 7.x line.** 7.x is a new native
   (non-Node) compiler; pinning the last 5.x keeps `tsx`/`vitest`/editor tooling,
   which assume the classic tsc CLI, working without surprises.
3. **React pinned to 18.3.1** per the explicit build instruction ("React 18 + Vite"),
   even though 19.x is now the npm default tag; `@vitejs/plugin-react` pinned to the
   matching 4.x line.
4. **Tailwind v4** (`@tailwindcss/vite` plugin, `@import "tailwindcss"` in CSS, no
   `tailwind.config.js`) since v4 is current and the plugin removes a postcss config
   file for no loss of function.
5. **`shared/` ships untranspiled TypeScript.** Both `tsx` (server) and Vite (web) can
   resolve `.ts` directly through the workspace symlink, so there is no build step or
   stale-dist risk for shared types; `npm run build -w shared` only type-checks it.
6. **Server tests run under Vitest**, not Node's built-in test runner, so the same
   `vitest.config.ts` resolves the shared workspace alias and ESM/TS without a build
   step; it is a devDependency, not a runtime one.
7. **DB migrations are idempotent `CREATE TABLE IF NOT EXISTS` run on every boot**
   (`server/src/db/schema.ts`), not a numbered migration chain, since the schema is
   fixed for v1 and the spec only asks for "migrations on boot."
8. **Embeddings and documents store vectors as JSON text columns** in SQLite (no
   `sqlite-vec`), per the one-shot substitution table; cosine similarity runs in JS.
9. **`node-gyp rebuild` for `better-sqlite3`** required `npm install-scripts approve`
   under npm's install-script gate; recorded here since it's a one-time local step a
   fresh clone will also need the first time (`npm install` prompts for it).
10. **`server/src/env.ts` exposes functions, not frozen constants**, for every path
    and flag (`isMockMode()`, `publikApiBaseUrl()`, `voiceboxHome()`, ...). A plain
    `export const` would freeze its value at first import, which breaks under ESM's
    import hoisting the moment a test tries to set `VOICEBOX_MOCK` or redirect
    `VOICEBOX_HOME` before exercising the module.
11. **`x-publik-*` response header names are assumed**, not confirmed against a live
    publik account: `x-publik-model`, `x-publik-charge-micros` (the one name the spec
    states verbatim), `x-publik-balance-after-micros`, `x-publik-weekly-usage-micros`,
    `x-publik-weekly-budget-micros`, `x-publik-reset-at`. If the live API differs,
    only `extractUsageHeaders` in `server/src/ai/client.ts` needs to change.
12. **Embeddings use the tier name `publik-embed`**, invented the same way the chat
    tiers are: a name, never a vendor model string, since the spec's tier table only
    covers chat completions.
13. **Mock mode's embeddings call throws rather than faking a response.** The spec
    says mock mode should fall back to local TF-IDF for embeddings, and that fallback
    needs corpus-wide context the generic AI client doesn't have — so the client
    throws and the embeddings module (step 6) catches it and switches to TF-IDF.
