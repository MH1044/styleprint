# Progress

Each entry is the gate command and its real output, pasted after a passing run.

## Step 1 — scaffold

Command: `npm run dev` (background), then `curl -s localhost:3001/health`

```
{"ok":true}
```

Both `server` (Express on :3001) and `web` (Vite on :5173) started from the one
root `npm run dev`. Gate passed.

## Step 2 — SQLite schema

Command: `npm run test:db`

```
 RUN  v5.1.0 <repo>/server

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  23:29:08
   Duration  214ms (transform 63%, import 23%, tests 10%, worker 4%)
```

All eight tables from the data model exist, one row was created and read back
per table, and cascade delete on `profiles` removes dependent `samples` and
`chunks`. Gate passed.

## Step 3 — ingest

Command: `npm run test:ingest`

```
 RUN  v5.1.0 <repo>/server

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  23:34:09
   Duration  576ms (import 64%, tests 26%, transform 10%, worker 1%)
```

All three `fixtures/corpus/*.md` files ingest with plausible word and chunk
counts; `.docx` and `.pdf` extraction round-trip through `mammoth`/`pdf-parse`;
boilerplate stripping removes signatures, quoted replies, page numbers and
bare URLs without eating real content; the sentence splitter survives common
abbreviations; near-duplicate paragraphs are dropped; uniform list-heavy text
is flagged as AI-like and bursty human prose is not. Gate passed.

## Step 4 — fingerprint

Command: `npm run test:fingerprint`

```
 RUN  v5.1.0 <repo>/server

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  23:36:50
   Duration  230ms (transform 57%, tests 27%, import 13%, worker 3%)
```

`computeStyleProfile` produces the full feature table (sentence/paragraph
length, function-word frequency, punctuation habits, openers, contractions,
vocabulary, hedging, quirks) plus derived targets for every corpus fixture;
cosine similarity of a text's feature vector against itself is exactly 1.0,
and the voice-match score between two different human voices lands strictly
between 0 and 100. Gate passed.

## Step 5 — AI client

Command: `npm run test:ai`

```
 RUN  v5.1.0 <repo>/server

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  23:40:41
   Duration  335ms (import 60%, transform 33%, tests 5%, worker 2%)
```

Mock mode returns a pass-2 rewrite with a parseable `{confidence, changed,
unsure}` JSON tail, a pass-1 rewrite with no tail, and is deterministic for
the same paragraph. Credential resolution follows the required order: own
key (from the credential file) beats `PUBLIK_API_KEY` beats the per-install
credential file beats nothing, which throws `NoCredentialsError`. Gate
passed.

## Step 6 — embeddings and retrieval

Command: `npm run test:embeddings`

```
 RUN  v5.1.0 <repo>/server

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  23:42:52
   Duration  339ms (import 61%, transform 34%, tests 4%, worker 2%)
```

In mock mode (TF-IDF fallback path), a fixture paragraph used as its own
query comes back first with score 1.0; a topically related paragraph outranks
unrelated ones; TF-IDF vectors share one vocabulary and are deterministic for
identical text. Gate passed.

## Step 7 — style card and the two-pass pipeline

Command: `npm run test:pipeline`

```
 RUN  v5.1.0 <repo>/server

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  23:51:52
   Duration  365ms (import 65%, tests 17%, transform 16%, worker 2%)
```

`fixtures/draft.md` runs through style-card generation, pass 1 (de-AI), pass
2 (voice, with retrieved corpus examples), and the local+fast post-check with
single retry, all in mock mode. Every number and proper noun in the draft
(42%, 1,200, $3.2 million, 15 countries, 78%/65%/12%/9%, 300, Acme
Corporation, San Francisco, Microsoft Teams, Austin, Maria Alvarez, Q3
2026, Q1 2027) survives in the final text, every paragraph ends `done` or
`needs_review`, and the voice-match score rises (89 → 94 on this fixture).
Gate passed.

Fixed along the way: `parsePass2Response` was finding the last `{` character
anywhere in the response, which lands inside the nested `unsure` array
instead of at the start of the top-level tail object; it now reads the
JSON tail from the final line only, per the prompt's own instruction.

## Step 8 — frontend

Command: `npm run build`

```
> @styleprint/shared@0.1.0 build
> tsc -p tsconfig.json --noEmit

> @styleprint/server@0.1.0 build
> tsc -p tsconfig.json --noEmit

> @styleprint/web@0.1.0 build
> tsc -p tsconfig.json --noEmit && vite build

vite v6.4.5 building for production...
✓ 98 modules transformed.
dist/index.html                 0.39 kB │ gzip:   0.26 kB
dist/assets/index-yENcD4bt.css  12.56 kB │ gzip:   3.44 kB
dist/assets/index-KbC6cv3s.js   629.88 kB │ gzip: 200.53 kB
✓ built in 1.53s
```

Command: `npm run test:e2e`

```
Running 1 test using 1 worker

  ✓  1 [chromium] › e2e\smoke.spec.ts:21:1 › full flow: profile -> ingest -> rewrite -> wizard -> editor -> export (2.9s)

  1 passed (6.7s)
```

Both halves of the gate are green: `npm run build` type-checks shared,
server and web with no errors and produces a production bundle; the
Playwright smoke test walks a real browser through create profile → paste
two writing samples → build style card → paste an AI draft → rewrite →
resolve all wizard cards by keeping them → open in editor → run voice check
→ open the export dialog → download a `.docx`, a `.pdf` and a `.md`, all in
mock mode with no key and no network.

Fixed along the way: the wizard queue was keying "still needs review" on
whether a paragraph had any `unsureJson` entries, but mock mode's pass 2
always attaches one — so a paragraph never left the queue even after the
user kept it, and the smoke test caught the counter never moving past "3
left to review". The queue now also excludes any paragraph with a logged
decision.

## Step 9 — export

Command: `npm run test:export`

```
 RUN  v5.1.0 <repo>/server

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  00:07:49
   Duration  430ms (import 55%, tests 31%, transform 13%, worker 1%)
```

The exported `.docx` round-trips through `mammoth.extractRawText` and
contains both the heading (document title) and every body paragraph, with
and without a title page/AI-assisted footer. The `.md` export's body (after
stripping the `# ` heading marker) matches the plain-text export built from
the same editor paragraphs. The `.pdf` export loads back with `pdf-lib`,
honours Letter vs A4 page width, and paginates a long document across
multiple pages. Gate passed.

## Step 10 — publik wiring

Command: `npm run test:publik`

```
 RUN  v5.1.0 <repo>/server

 Test Files  1 passed (1)
      Tests  1 passed | 1 skipped (2)
   Start at  00:09:37
   Duration  297ms (import 75%, transform 20%, tests 2%, worker 2%)
```

No `PUBLIK_API_KEY` is set in this environment, so the real-call test is
skipped by design (`it.runIf`) and the mock-gate test runs instead,
confirming a `publik-fast` mock call still returns a usable charge and
model name. Added: `GET /wallet/credential-status` and a first-run banner
that offers "use your own key" or "set up a free per-install key" when no
credential exists (never shown in mock mode); `AGENTS.md` with the publik
setup prompt, client-selection order, and per-call rules; `README.md` with
install, mock mode, own-key, and the token-mint procedure as a numbered
human step. Gate passed.

## Step 11 — final

Command: `npm run check`

```
=== Gate 1: scaffold (health check) ===
curl localhost:3001/health -> {"ok":true}

=== Gate 2: db schema ===
 Test Files  1 passed (1)   Tests  3 passed (3)

=== Gate 3: ingest ===
 Test Files  1 passed (1)   Tests  14 passed (14)

=== Gate 4: fingerprint ===
 Test Files  1 passed (1)   Tests  6 passed (6)

=== Gate 5: ai client ===
 Test Files  1 passed (1)   Tests  8 passed (8)

=== Gate 6: embeddings and retrieval ===
 Test Files  1 passed (1)   Tests  5 passed (5)

=== Gate 7: style card and pipeline ===
 Test Files  1 passed (1)   Tests  1 passed (1)

=== Gate 8: frontend (build + e2e) ===
vite v6.4.5 building for production...
✓ 99 modules transformed.
dist/assets/index-CrDmKQoC.js   632.05 kB │ gzip: 201.16 kB
✓ built in 1.54s
Running 1 test using 1 worker
  ✓  1 [chromium] › smoke.spec.ts full flow (2.8s)
  1 passed (6.6s)

=== Gate 9: export ===
 Test Files  1 passed (1)   Tests  7 passed (7)

=== Gate 10: publik wiring ===
 Test Files  1 passed (1)   Tests  1 passed | 1 skipped (2)

All eleven gates passed.
```

(Full per-gate output, unabridged, is in the Step 1-10 sections above; this
is `npm run check` — `scripts/check.mjs` — running every one of them in
sequence from a single command, which is itself gate 11's requirement.)
`README.md`, `LICENSE` (AGPL-3.0), `AGENTS.md` and the versioned `prompts/*.md`
files are all in place. Gate passed. Definition of done is met.

## Follow-up — desktop installer (Tauri)

Not one of the eleven build-order gates; a follow-up milestone built after the
build plan was complete, per the spec's own note that "Tauri wrap is a
follow-up."

Command: `npm run desktop:build`

```
    Finished `release` profile [optimized] target(s) in 1m 59s
       Built application at: <repo>\src-tauri\target\release\styleprint.exe
     Running makensis to produce .../bundle/nsis/Styleprint_0.1.0_x64-setup.exe
     Running light to produce .../bundle/msi/Styleprint_0.1.0_x64_en-US.msi
    Finished 2 bundles at:
        .../bundle/nsis/Styleprint_0.1.0_x64-setup.exe (10.74 MiB)
        .../bundle/msi/Styleprint_0.1.0_x64_en-US.msi (14.95 MiB)
```

Verified by actually launching the built `styleprint.exe` (not just a successful
compile): it spawned the bundled server, which answered `/health` with
`{"ok":true}`, served the built frontend at `/` with a 200, and opened a real
native window titled "Styleprint" (confirmed via `Get-Process`'s
`MainWindowTitle`). Two real bugs were caught this way and fixed — neither
would have shown up from a green compile alone:

1. esbuild leaves `import.meta` empty when bundling to CJS, which silently
   broke every module that resolves files relative to its own location
   (prompts/, the web build, the app token). Fixed by bundling to ESM
   (`.mjs`) instead, with a `createRequire` banner for one remaining
   CJS-dependency edge case.
2. `resource_dir()` returns a `\\?\`-prefixed Windows extended-length path;
   passed straight through as Node's CLI argument, every launch failed with
   `EISDIR: illegal operation on a directory, lstat 'C:'`. Fixed by stripping
   the prefix before handing the path to `node`.

`npm run check` (all eleven original gates) was re-run after this work and is
still green — see DECISIONS.md #31-37 for what's in scope for this pass
(Windows only, still requires Node.js on the target machine, placeholder
icon) and what's left as further follow-up.

## Follow-up — standalone installers

The installers now ship their own Node.js runtime (DECISIONS.md #53-#59), and every
installer is installed and checked before a release.

Command: `node scripts/fetch-node.mjs`

```
Downloading https://nodejs.org/dist/v24.20.0/win-x64/node.exe
Node.js v24.20.0 for x86_64-pc-windows-msvc written to <repo>\src-tauri\binaries\node-x86_64-pc-windows-msvc.exe
```

Command: install the NSIS build silently, then run the installed app's smoke test
with only `%SystemRoot%\System32` on PATH (no system Node.js):
`STYLEPRINT_SMOKE_TEST=1 "%LOCALAPPDATA%\Styleprint\styleprint.exe"`

```
installer exit: 0
smoke test: bundled Node.js v24.20.0 win32-x64 at %LOCALAPPDATA%\Styleprint\node.exe
[server] styleprint server listening on http://127.0.0.1:57787
smoke test: database ok
smoke test: web UI ok
smoke test: ok (Node.js v24.20.0 win32-x64)
```

The first run of that same smoke test failed, and is why it exists: the installed
server crashed on startup with `ReferenceError: DOMMatrix is not defined`, then
`Setting up fake worker failed: Cannot find module '...\server\pdf.worker.mjs'`.
Every installed 0.1.x copy had the same crash; earlier checks ran the built app from
inside the repo, where Node found `@napi-rs/canvas` and the pdfjs worker in the repo's
own `node_modules`. Fixed in DECISIONS.md #58.

Then the real app, launched normally:

```
window title: 'Styleprint'
node child: %LOCALAPPDATA%\Styleprint\node.exe
console host under node: (none)
listening: 127.0.0.1:47821
health: {"ok":true,"instance":"4058-18e7a8bd81e25e18"}
--- close the window normally ---
app running: False; node running: False
--- force-quit ---
node running after the app was killed: False
```

With `node.exe` removed from the install folder, the window shows the startup page's
error ("Styleprint couldn't start · Styleprint's installation is incomplete") instead
of nothing.

Command: `node scripts/e2e-installed.mjs "%LOCALAPPDATA%\Styleprint\node.exe" "%LOCALAPPDATA%\Styleprint\server\index.mjs"`

```
installed server is up at http://127.0.0.1:50277 (%LOCALAPPDATA%\Styleprint\node.exe)
  ✓  1 [chromium] › e2e\smoke.spec.ts:33:1 › full flow: profile -> ingest -> rewrite -> wizard -> editor -> export (6.5s)
  1 passed (9.6s)
```

On a clean GitHub Actions runner (release workflow, Windows job):

```
Installing Styleprint_0.1.0_x64_en-US.msi
MSI installed to C:\Program Files\Styleprint\
smoke test: bundled Node.js v24.20.0 win32-x64 at C:\Program Files\Styleprint\node.exe
smoke test: database ok
smoke test: web UI ok
smoke test: ok (Node.js v24.20.0 win32-x64)
Installing Styleprint_0.1.0_x64-setup.exe
NSIS installed to C:\Users\runneradmin\AppData\Local\Styleprint
smoke test: bundled Node.js v24.20.0 win32-x64 at C:\Users\runneradmin\AppData\Local\Styleprint\node.exe
smoke test: database ok
smoke test: web UI ok
smoke test: ok (Node.js v24.20.0 win32-x64)
installed server is up at http://127.0.0.1:50380 (C:\Users\runneradmin\AppData\Local\Styleprint\node.exe)
  1 passed (6.3s)
```

And the macOS job, on the app copied out of the built `.dmg`:

```
/Users/runner/work/_temp/Styleprint.app: valid on disk
/Users/runner/work/_temp/Styleprint.app: satisfies its Designated Requirement
Identifier=app.styleprint.desktop
Format=app bundle with Mach-O universal (x86_64 arm64)
Signature=adhoc
Architectures in the fat file: /Users/runner/work/_temp/Styleprint.app/Contents/MacOS/styleprint are: x86_64 arm64
Architectures in the fat file: /Users/runner/work/_temp/Styleprint.app/Contents/MacOS/node are: x86_64 arm64
smoke test: bundled Node.js v24.20.0 darwin-arm64 at /Users/runner/work/_temp/Styleprint.app/Contents/MacOS/node
smoke test: database ok
smoke test: web UI ok
smoke test: ok (Node.js v24.20.0 darwin-arm64)
Intel (x86_64) half, under Rosetta 2:
smoke test: bundled Node.js v24.20.0 darwin-x64 at /Users/runner/work/_temp/Styleprint.app/Contents/MacOS/node
smoke test: database ok
smoke test: web UI ok
smoke test: ok (Node.js v24.20.0 darwin-x64)
```

Fixed along the way, each caught by these checks: a universal macOS build also needs
each single-architecture Node.js sidecar (the build failed with ``resource path
`binaries/node-aarch64-apple-darwin` doesn't exist``); the MSI reuses an NSIS install's
folder, so the workflow reads each install location from the registry; and on the
slower macOS runner the end-to-end flow exposed the paste box clearing a second sample
pasted while the first was still saving.

## Follow-up — M2 and M3 gaps

Learning from decisions (M2), and the editor's structure, footnotes and versions (M3):
DECISIONS.md #46-#52.

Command: `npm run check`

```
=== Gate 7: style card and pipeline ===
 Test Files  2 passed (2)
      Tests  7 passed (7)
=== Gate 8: frontend (build + e2e) ===
  1 passed (18.6s)
=== Gate 9: export ===
 Test Files  2 passed (2)
      Tests  22 passed (22)
All eleven gates passed.
```

Gate 7 now includes `server/tests/learning.test.ts` (allowed words, favourite phrases,
the 20-decision style card refresh, the migration of an older database); gate 9
includes `server/tests/document.test.ts` (draft structure, the editor's document,
versions) and the rewritten export tests. The Playwright flow now pastes a draft with a
heading and a footnote, keeps one wizard card and skips the rest, types and adds a
footnote in the editor, saves, compares and restores a version, and checks the `.md`
and `.docx` exports against what the editor shows.

M3's "done when" is "exported .docx opens cleanly in Word with headings and footnotes
intact". Command: open the exports in Microsoft Word (automation, read-only) and list
what Word sees:

```
=== desktop-export.docx ===        (exported from the installed app's window)
footnotes: 1
  [1] Q2 2026 board pack, p. 4.
  [Title] Desktop export check
  [Heading 2] Where the money went
  [Normal] Revenue rose 11% in Q2 2026. Moreover, costs fell across 9 offices.
  [Normal] The team in Denver led the work.
footer: Page 1 of 1
=== rich-export.docx ===
footnotes: 2
  [1] Q2 2026 board pack, p. 4.
  [2] Staff survey, June 2026.
  [Title] Northwind report
  [Heading 1] Remote work at Northwind
  [Normal] Revenue rose 11% and costs fell.
  [Heading 2] Offices
  [List Paragraph] Denver
  [List Paragraph] Austin
  [List Paragraph] First step
  [List Paragraph] Second step
  [Quote] Ship it.
  [Normal] City
  [Normal] Staff
  [Normal] Denver
  [Normal] 800
  [Normal] A second claim.
footer: Page 1 of 1 Drafted with AI assistance.
```

(Word also reported one table and the two lists as bulleted and numbered lists.) The
same files through LibreOffice (`soffice --headless --convert-to txt`):

```
Northwind report
Remote work at Northwind
Revenue rose 11%1 and costs fell.
Offices
    • Denver
    • Austin
    1. First step
    2. Second step
Ship it.
City	Staff
Denver	800
A second claim2.
```

The first file was exported by clicking `.docx` in the installed desktop app; the
window then showed "Saved to %USERPROFILE%\Downloads\Desktop export check.docx".
Google Docs was not checked.
