# Decisions

One line each, in build order, for every place the spec was silent or the
build plan needed a concrete choice.

1. **Repo root has no Rust/Tauri shell.** Monorepo is `shared/`, `server/`, `web/` npm
   workspaces, matching the build plan's Node+Express+Vite substitution.
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
   `sqlite-vec`), per the build plan's substitution table; cosine similarity runs in JS.
9. **`node-gyp rebuild` for `better-sqlite3`** required `npm install-scripts approve`
   under npm's install-script gate; recorded here since it's a one-time local step a
   fresh clone will also need the first time (`npm install` prompts for it).
