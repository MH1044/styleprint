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
9. ~~`node-gyp rebuild` for `better-sqlite3` required `npm install-scripts approve`~~
   **Correction (see #44): this was never necessary and is now actively wrong.**
   `better-sqlite3@13.0.3` ships prebuilt native binaries for every platform/arch
   inside the npm package itself; approving and running its install script instead
   triggers a real from-source compile, which only "worked" locally because this
   machine happens to have usable Visual Studio tools. Left struck through rather
   than deleted, since #44 explains the fix and a silently-vanished decision is
   harder to learn from than a visibly corrected one.
10. **`server/src/env.ts` exposes functions, not frozen constants**, for every path
    and flag (`isMockMode()`, `publikApiBaseUrl()`, `styleprintHome()`, ...). A plain
    `export const` would freeze its value at first import, which breaks under ESM's
    import hoisting the moment a test tries to set `STYLEPRINT_MOCK` or redirect
    `STYLEPRINT_HOME` before exercising the module.
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
21. *(Not used: the number was skipped when this list was first written; later entries keep
    their numbers so references to them stay valid.)*
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
27. **Playwright's e2e `STYLEPRINT_HOME` lives under the OS temp dir, not inside
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
30. ~~**`publik-app-token.txt` ships with a placeholder value**~~ **Superseded:** the real public
    `pat_` token for the live listing is committed now. Originally: a placeholder, not a real `pat_` token
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
33. ~~**The installer still requires Node.js on the end user's machine.**~~ **Superseded by #53.** `server/scripts/
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
36. ~~**App icon is a generated placeholder**~~ **Superseded by #63.** (`src-tauri/icons/icon-source.png`, a plain
    two-tone chevron, run through `npm run desktop:icon`), not real brand art. Swap the
    source PNG and rerun that script before shipping a real release.
37. **`bundle.targets` is `"all"`**, not an explicit list — it was `["nsis", "msi"]`
    (Windows-only) until macOS support was added; `"all"` lets Tauri pick the right
    bundle types per host OS (dmg/app on macOS, nsis/msi on Windows) from one config.

## macOS support, added as a further follow-up

38. **macOS builds run on GitHub Actions, not locally.** This project's build
    environment is Windows-only; Tauri/Rust can't cross-compile a macOS `.app` from
    Windows (needs Apple's SDK and codesigning tools). `.github/workflows/
    desktop-release.yml` builds on `macos-latest` on a version tag or manual dispatch.
    Unverified by direct testing (no Mac to click-test on) — verify via the Actions
    run logs and, ideally, an actual Mac before relying on it for a real release.
39. **Universal binary (arm64 + x64 in one `.dmg`)**, via `tauri build --target
    universal-apple-darwin` with both Rust targets installed on the CI runner. This
    works cleanly here because of decision 40 — a true universal *app* with a
    single-arch *native dependency* inside would silently break on one architecture.
40. **The server bundle is built once (on a plain `ubuntu-latest` job) and reused for
    every platform's Tauri build**, rather than rebuilt per-OS. `better-sqlite3`
    ships prebuilt native binaries for every platform/arch combination inside the npm
    package itself (`prebuildify`-style — `node_modules/better-sqlite3/prebuilds/*.node`),
    selected at `require()` time by the *running* process's platform/arch, not by
    whatever machine ran `npm install`. One bundle is therefore already portable
    everywhere; building it three times would just be slower for no benefit.
41. ~~**`tauri.conf.json`'s `build.frontendDist` points at a static placeholder**~~ **Superseded by #57**,
    which turns that directory into a real startup page.
    (`src-tauri/dummy-dist/index.html`), not `../web/dist`. This app never loads
    Tauri's own bundled frontend — `main.rs` always opens a window pointed at the
    locally-running Express server's URL once it's healthy — but the Tauri CLI still
    hard-requires `frontendDist` to exist as a real directory before it will bundle
    at all. Pointing it at `../web/dist` would force every platform's CI job to
    rebuild the web frontend before `tauri build`, for a directory that is never
    actually read; the placeholder removes that ordering dependency entirely.
42. **Not notarized on macOS for now** (no Developer ID). Ad-hoc signed since #55, which changes
    the first-launch warning described here. Users
    hit Gatekeeper's "app is damaged" warning until they right-click → Open once or
    run `xattr -cr`. Signing requires a paid Apple Developer account and credentials
    as CI secrets — a deliberate deferral, not an oversight; see README's macOS section.
43. **Correction: the real minimum is Node 22, not 20.** `package.json`'s `engines`
    field said `>=20` since step 1 (matching the spec's literal "Node 20" instruction),
    and every local gate passed because this machine happens to run Node 24. The
    desktop-release workflow's first real CI run caught the gap: `better-sqlite3@13.0.3`
    declares `"engines": {"node": ">=22"}`; under Node 20 its prebuilt binary wasn't
    used and npm fell back to compiling from source, which then failed on the Windows
    runner for a second, unrelated reason (no usable Visual Studio install detected).
    `engines` is now `>=22` and the workflow's `setup-node` steps request Node 22 — the
    one instruction in the original build spec this build deviates from outright,
    because the alternative is a project that cannot actually install on the version
    it claims to support.
44. **`better-sqlite3` is never approved in `allowScripts`, and should not be.** Raising
    the Node version (#43) didn't fix the Windows CI failure — it was never a Node
    version problem. `better-sqlite3@13.0.3` sets `"gypfile": false` and ships
    prebuilt binaries for every platform/arch directly in the package
    (`node_modules/better-sqlite3/prebuilds/*.node`, committed data files, not build
    output); a plain `npm ci`/`npm install` uses one of those with no compile step
    and no approval needed, confirmed by a from-scratch local reinstall. Approving its
    install script does the opposite of what the earlier decision #9 assumed: it
    makes npm attempt a real `node-gyp rebuild` from source, which depends on a
    working Visual Studio detection that failed on the GitHub-hosted Windows runner
    (node-gyp couldn't parse that runner's installed VS version string) even after
    the Node bump. Removing the approval fixed Windows CI outright.
45. **Renamed Voicebox → Styleprint before listing**, because "voicebox" was already
    taken on publik. Checked `styleprint` was free on npm first (a 404, not a version)
    before committing to a full rename: npm scope (`@voicebox/*` → `@styleprint/*`),
    env vars (`VOICEBOX_MOCK`/`VOICEBOX_HOME` → `STYLEPRINT_MOCK`/`STYLEPRINT_HOME`),
    the data directory (`~/.voicebox` → `~/.styleprint`), the publik `APP_SLUG`, the
    Tauri identifier/productName/binary name, the GitHub repo
    (`MH1044/voicebox` → `MH1044/styleprint`), and every doc. A mechanical, three-pass
    case-sensitive find-and-replace (`Voicebox`→`Styleprint`, `VOICEBOX`→`STYLEPRINT`,
    `voicebox`→`styleprint`) across every non-generated source and doc file, since the
    three cases never collide as substrings of each other. `SPEC.md` is untouched — it's
    the user's own original document and "Voicebox (working name)" is accurate history,
    not a bug to fix.

## Standalone installers, editor structure and learning (0.1.2)

46. **Exports render from the editor's document, built once from the draft's structure.** Exports
    used to read the raw rewrite (the `paragraphs` rows) and the editor rebuilt itself from them on
    every open, so editor changes never reached an export and were discarded on reopen. Now
    `documents.editor_json` is the single source of truth: composed the first time it's needed from
    the draft's structure plus the wizard's results (`server/src/document/structure.ts`), saved, and
    rendered by every format through one block model (`server/src/export/model.ts`).
47. **Draft headings and Markdown footnotes are structural.** Only paragraphs go through pass 1/2.
    Footnote references (`[^label]`) are protected like facts; definitions (`[^label]: text`) are
    taken out of the body, running on until a blank line as in GitHub-flavoured Markdown; an
    undefined reference stays as literal text. Heading levels are kept as written, and the document
    title uses Word's Title style instead of Heading 1 so a draft's own `#` heading keeps its level.
48. **A wizard decision made after the editor exists is carried into it**, unless the editor's text
    for that paragraph no longer matches what the wizard last produced: then the user has edited it
    by hand there, and the editor wins. Paragraphs are matched by a `paragraphId` attribute.
49. **Typing in a paragraph marks it hand-edited**; loading or restoring a document doesn't (both
    replace content with update events off, which the provenance plugin skips). A new paragraph
    defaults to hand-edited and never inherits the `paragraphId` of the one it was split from.
50. **Versions are saved at every wizard exit, every export, and on demand; an identical consecutive
    version is skipped; restoring first saves what it replaces**, so a restore can be undone.
    Exports are GET downloads, so their snapshot is a side effect of that GET, by design (Stage 6).
51. **Learning from decisions.** Allowed words come from a revert whose original had an avoid-list
    word the rewrite had removed. Favourites are 2-4 word phrases, never crossing punctuation and
    containing at least one non-glue word, added in three separate edits; the longest are kept,
    without repeating one inside a longer favourite. The fingerprint's 150 "function words" are
    really the most common words ("thing", "work" included), too broad to filter phrases with, so
    learning has its own short glue-word list. The style card refresh runs when the wizard finishes
    with at least 20 decisions since the last one, not on the twentieth click, so a slow publik call
    never stalls a review card; a failed refresh is reported and tried again next time, and never
    blocks the editor. Rebuilding a card from scratch restarts the count but keeps the learned words
    and phrases in its appendix.
52. **`profiles.learned_json` is added by an idempotent migration** (`migrate()` in
    `server/src/db/schema.ts`), since `CREATE TABLE IF NOT EXISTS` never alters a table that exists.
53. **The desktop app ships its own Node.js runtime.** The official Node.js 24.20.0 build, the version
    the tests run on, is a Tauri `externalBin` sidecar, downloaded at build time and checked against
    nodejs.org's SHASUMS256 (`scripts/fetch-node.mjs`) rather than committed (about 90 MB). For the
    universal macOS build the arm64 and x64 runtimes are joined with `lipo`, and each
    single-architecture binary is kept too: Tauri compiles the app once per architecture first, and
    each of those builds checks for its own sidecar.
54. **Node 24, so macOS 13.5 is the minimum.** Node 22 would reach macOS 11, but its support ends in
    April 2027, which would only defer the same floor. `bundle.macOS.minimumSystemVersion` matches
    Node's own floor, so an older Mac gets the system's "requires macOS 13.5" message instead of a
    silent failure.
55. **macOS builds are ad-hoc signed, with the hardened runtime off.** A downloaded arm64 app with no
    signature is reported "damaged" with no way to open it from Finder; an ad-hoc signature turns
    that into the "can't check it" warning that Privacy & Security's Open Anyway clears. The
    hardened runtime only matters for notarization, and would need JIT entitlements for Node.js.
56. **The desktop server listens on 127.0.0.1, proves its identity, and stops with the app.** It
    used to listen on every interface (anyone on the same network could read the corpus or spend
    the user's publik balance) and kept running after the window closed, holding the port and, on
    Windows, locking installed files against an upgrade. Now `STYLEPRINT_HOST` is 127.0.0.1;
    `/health` echoes a per-launch `STYLEPRINT_INSTANCE` token so the shell never mistakes another
    process on the port for its server; the shell stops the server on exit, and the server also
    exits when its stdin closes, which covers a force-quit. The usual port (47821) keeps the UI's
    origin, and with it its saved settings, stable between launches; any free port is used if it's
    taken.
57. **The window opens on a startup page** (`src-tauri/startup-page/`), switches to the app when the
    server answers, and otherwise shows the reason, the server's last log lines and platform help.
    A failed start used to show no window at all. On Windows the server runs without a console window.
58. **PDF text extraction loads on first use, with a pure-JS DOMMatrix and the pdfjs worker bundled
    in.** pdf-parse's renderer builds a `DOMMatrix` at load time, borrowed in Node from the native
    `@napi-rs/canvas`, and its parser loads a `pdf.worker.mjs` from beside its own module. The
    single-file bundle had neither, so every installed 0.1.x copy crashed at startup; checks run from
    inside the repo passed because both resolved from the repo's `node_modules`. `@thednp/dommatrix`
    stands in (extracting text never draws), importing the worker registers it on
    `globalThis.pdfjsWorker`, and loading lazily means the PDF stack can only fail a PDF upload.
59. **Every installer is installed and checked on a clean runner before a release.** The release
    workflow installs the MSI, the NSIS installer and the `.dmg` (each installer's location read from
    the registry; the MSI goes first because it reuses an existing NSIS install's folder), runs the
    app's `STYLEPRINT_SMOKE_TEST` mode with no system Node.js on PATH (on macOS for both
    architectures, the Intel half under Rosetta), and runs the end-to-end flow against the installed
    server (`scripts/e2e-installed.mjs`). Any failure stops the release.
60. **The desktop app handles downloads itself, and export clicks ask for a generic file type.**
    Without a download handler macOS WebKit never downloads anything; with one, it still shows
    anything it can display (a PDF, text) in place of the app. Clicks add `download=1`, the server
    answers `application/octet-stream`, and the handler saves to Downloads (numbering rather than
    overwriting) and tells the page where.
61. **PDF export substitutes characters the standard PDF fonts can't encode** (arrows become ASCII,
    anything else "?") rather than failing the export.
62. **One script sets and checks the version** (`scripts/set-version.mjs`, ten places), and the
    release workflow refuses a tag that doesn't match; 0.1.1 shipped reporting 0.1.0.
63. **The app icon is a fingerprint of pen-stroke ridges on a terracotta tile**, drawn as SVG
    (`src-tauri/icons/icon-source.svg`), the same accent as the startup page; it is also the web
    favicon.
