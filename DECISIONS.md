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
14. **Headings are stripped before the per-paragraph rewrite loop**, not fed through
    pass 1/2. Stage 5 says the pipeline only rewrites text runs inside a block, never
    the block type, and a Markdown `#` heading is structural, not prose to humanise.
15. **Mock mode's rewrite does more than the literal spec sentence** (shuffle +
    contract + tail). It also strips a fixed list of stock AI filler openers
    ("Moreover,", "In today's fast-paced world,", ...) and splits sentences over 26
    words at a conjunction. A pure shuffle never changes a paragraph's sentence-length
    mean/std, so the build-order gate 7 requirement ("raises the voice-match score")
    could not pass under the literal minimal description — these two extra,
    deterministic, offline steps are what a real de-AI pass would also do.
16. **`voiceMatchScore` is a weighted average of four group cosine similarities**
    (sentence/paragraph rhythm 0.4, punctuation+contractions 0.25, vocabulary/hedging
    0.15, function-word profile 0.2), not one flat cosine over the full concatenated
    vector. The 150-wide function-word block otherwise dominates the flat cosine by
    sheer dimension count, so a real rewrite that measurably changes rhythm and
    contractions barely moves the score. `styleVector`/`cosineSimilarity` stay
    exported as-is for anything that wants the flat comparison.
17. **`GET /wallet` response field names are assumed** the same way the headers are:
    `balance_micros`, `weekly_usage_micros`, `weekly_budget_micros`, `reset_at`. Only
    `getWallet` in `server/src/ai/client.ts` needs to change if the live shape differs.
18. **The wizard's per-paragraph "voice match below 60" queue bucket is not
    implemented.** A single short paragraph has too few sentences for the Layer-1
    fingerprint's std-dev-based stats to mean anything; the queue instead orders by
    needs-review first, then by ascending pass-2 confidence, which covers the two
    statistically meaningful signals the spec lists.
19. **The wizard's "try again" retry reruns pass 2 only**, not pass 1, starting from
    the stored pass-1 output. The steer is a voice/tone correction ("more blunt",
    "this is a joke"), which is pass 2's job; re-running pass 1 as well would also
    re-roll the de-AI rewrite for no reason tied to the user's steer.
20. **Navigation is five local view-state buttons in `App.tsx`**, not a router
    library. The app has five fixed screens in a fixed order; `react-router` would be
    a runtime dependency for something five `useState` branches already do.
22. **No diffing/markdown-editor dependency for the wizard's word-level highlight.**
    `web/src/lib/diff.ts` is a small from-scratch LCS word diff — the only thing it
    needs to do is highlight changed words between two short paragraphs.
23. **The wizard card doesn't show the two retrieved corpus examples the model
    leaned on.** Retrieved examples are passed to pass 2 but not persisted per
    paragraph (no column for it, and adding one would deviate from the fixed data
    model); the card shows the model's own `unsure` reason instead, which is stored.
24. **`@tiptap/extension-table` bundles `Table`/`TableRow`/`TableHeader`/`TableCell`
    as named exports**, so the separate per-node packages the spec's dependency list
    implies aren't needed; removed them rather than carry three unused packages.
25. **Real OOXML footnotes aren't implemented.** The docx exporter writes heading +
    paragraphs only; Stage 6's footnote support would need a Tiptap footnote
    extension and matching `docx` footnote wiring, both out of scope for the first
    release. Noted so it isn't mistaken for an oversight.
26. **The wizard queue excludes any paragraph with a logged decision**, not just ones
    whose `unsureJson` is empty. Mock mode's pass 2 always attaches one `unsure` span,
    so a queue keyed only on "has an unsure span" never empties once the user starts
    resolving items — found by the step 8 Playwright smoke test, which kept clicking
    Keep without the counter ever moving.
27. **Playwright's e2e `VOICEBOX_HOME` lives under the OS temp dir, not inside
    `web/`.** Vite watches the whole web root; a repo-local SQLite data directory
    triggers a full page reload on every WAL write mid-test, wiping component state.
28. **The post-check's "one `publik-fast` call" is a per-paragraph semantic check**
    (`runFastTagCheck`) run after the local checks, on the accepted pass-2 output.
    Its failure is folded into the same single retry as the local checks, rather than
    triggering a separate retry budget, matching "re-run once... or marked needs
    review" read as one combined check-and-retry step, not two independent ones.
29. **The first-run card's "no credentials yet" check is a dedicated endpoint**
    (`GET /wallet/credential-status`), not inferred from a failed wallet call. Mock
    mode always reports a usable mock wallet, so the card needs its own signal to stay
    hidden in mock mode while still showing up on a genuine first run with no key.
30. **`publik-app-token.txt` ships with a placeholder value**, not a real `pat_` token
    — there is no real publik account to mint one from in this build. README says so
    explicitly rather than silently shipping something that looks real but isn't.

## Desktop wrap (Tauri), added as a follow-up milestone

31. **The desktop shell spawns the existing Express server as a plain child process**,
    not a Tauri "sidecar" (the convention of bundling a single native per-platform
    executable). The server is Node+TypeScript with one native dependency
    (`better-sqlite3`); turning it into a true sidecar would mean embedding a Node
    runtime binary, which is future work (decision 33).
32. **`std::process::Command`, not `tauri-plugin-shell`**, spawns the server.** The
    plugin's `Shell::command()` API is a thin wrapper for the same job and exists
    mainly so JS code can invoke shell commands via IPC — this app never does that
    (the spawn happens once, in Rust, in `setup()`), so the extra dependency and
    its permission/capability surface bought nothing.
33. **The installer still requires Node.js on the end user's machine.** `server/scripts/
    bundle-desktop.mjs` produces a single ESM bundle (`esbuild`, one native external:
    `better-sqlite3`, copied alongside with its own `node_modules`) that Tauri's Rust
    shell spawns via a plain `node` on PATH. A fully standalone installer would bundle
    a portable Node runtime as a real Tauri sidecar binary instead — documented here
    as the natural next step, not attempted in this pass.
34. **The server bundle targets ESM (`index.mjs`), not CJS.** Several modules resolve
    files relative to their own location via `import.meta.url` (prompts/, the web
    build, the app token) — esbuild leaves `import.meta` empty when bundling to CJS,
    silently breaking all of those. The `.mjs` extension forces Node to treat the
    single bundled file as ESM regardless of any nearby `package.json`. A `createRequire`
    banner patches the one remaining issue: some bundled CJS dependencies (`debug`,
    via `express`) call `require()` on Node core modules in a way esbuild can't
    statically resolve for ESM output.
35. **`resource_dir()`'s `\\?\`-prefixed Windows path is stripped before use as Node's
    CLI argument.** Node's file APIs handle Windows extended-length paths fine, but its
    *own* main-module resolver does not — passed through unmodified, every launch
    failed with `EISDIR: illegal operation on a directory, lstat 'C:'` (the resolver
    misreads the `\\?\` prefix as something UNC-shaped and truncates to the drive
    letter). Found by actually running the built installer's `.exe`, not by reading
    the Tauri docs — worth remembering if `resource_dir()` shows up anywhere else.
36. **App icon is a generated placeholder** (`src-tauri/icons/icon-source.png`, a plain
    two-tone chevron, run through `npm run desktop:icon`), not real brand art. Swap the
    source PNG and rerun that script before shipping a real release.
37. **Build targets are NSIS + MSI on Windows only** for now (`tauri.conf.json`'s
    `bundle.targets`); macOS/Linux bundles are unbuilt and untested since this machine
    is Windows-only. The Rust/TypeScript code has no Windows-specific assumptions
    beyond the path-prefix fix above, so other targets are plausible but unverified.
