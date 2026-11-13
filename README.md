# Styleprint

Styleprint takes your own past writing, builds a local style profile from it, and
rewrites AI-generated drafts so they read in your voice. The AI calls run through
[publik](https://publikhq.com/developers), a metered LLM gateway, so you pay cents per
use instead of a subscription. Your writing never leaves your machine — only the
paragraph being rewritten, a couple of neighbours, and a handful of retrieved examples
go to the model per call.

See `SPEC.md` for the full product spec and `DECISIONS.md` for every build-time choice
made where the spec was silent.

## Download

Get the latest installers from the
[Releases page](https://github.com/MH1044/styleprint/releases/latest). Nothing else
needs to be installed first: the app ships its own runtime.

**Windows 10 or 11 (64-bit):** `Styleprint_<version>_x64-setup.exe` (installs for your
user, no admin needed) or `Styleprint_<version>_x64_en-US.msi` (installs for everyone
on the machine). The installers aren't code-signed yet, so Windows SmartScreen may say
it protected your PC: choose **More info**, then **Run anyway**.

**macOS 13.5 or later (Apple Silicon or Intel):** `Styleprint_<version>_universal.dmg`.
Open it and drag Styleprint to Applications. The app isn't notarized by Apple yet, so
the first time you open it macOS warns that it can't check it. To open it anyway:

1. Open Styleprint once and dismiss the warning.
2. Go to **System Settings → Privacy & Security**, scroll down, and choose
   **Open Anyway** next to the message about Styleprint.

Or, in Terminal: `xattr -cr /Applications/Styleprint.app`. Either way, you only need to
do this once.

## Writing drafts

Paste a draft as plain text or Markdown. Markdown headings (`#`, `##`, …) are kept as
headings and never rewritten; only paragraphs are. Markdown footnotes (`[^1]` in the
text, with `[^1]: the note` anywhere below) survive the rewrite and become real
footnotes in the editor and in every export: Word footnotes in `.docx`, `[^n]` notes in
`.md`, a Notes section in `.txt` and `.pdf`.

The editor keeps a list of versions: one when you finish the review wizard, one for
each export, and any you save yourself. Each can be compared side by side with the
current text, or restored. And the more you review, the better it gets: once you've
made 20 review decisions, finishing a review rewrites your style card to include what
you corrected. Reverting a rewrite that removed a word you like stops later rewrites
removing it, and a phrase you add in three separate edits is remembered as one of yours.

## Run from source

### 1. Install

```
git clone https://github.com/MH1044/styleprint.git
cd styleprint
npm install
```

Node 22+ is required (`better-sqlite3`'s declared minimum, see DECISIONS.md #43).
No native build step needed: `better-sqlite3` ships a prebuilt binary for your
platform directly in the package (DECISIONS.md #44).

### 2. Run in mock mode (no key, no network, no spend)

```
STYLEPRINT_MOCK=1 npm run dev
```

This starts the API on `http://localhost:3001` and the app on `http://localhost:5173`.
Mock mode makes every AI call deterministic and local: you can create a profile, add
writing samples, build a style card, paste a draft, run the full rewrite, resolve the
review wizard, edit in the Tiptap editor, and export a `.docx`/`.pdf`/`.md` with zero
cost and zero network calls.

On Windows (PowerShell), set the variable first:

```
$env:STYLEPRINT_MOCK = "1"
npm run dev
```

### 3. Run for real: bring your own key

Any OpenAI-compatible endpoint works — publik itself, or a local server like Ollama or
LM Studio. In the app, the "No publik key yet" banner on first run lets you paste a key
and (optionally) a base URL; it's saved to `~/.styleprint/credential.json` (mode `0600`)
and never leaves your machine except as the `Authorization` header on each call.

Without the UI, set the environment variable instead:

```
PUBLIK_API_KEY=pk_live_your_key npm run dev
```

### 4. Run for real: a free per-install publik key

This is the path the app ships for people who don't want to paste a key by hand. A
fresh install starts at $0.00; linking the install to a publik account gives $0.05 of
free use once, with paid plans after that (see `SPEC.md`'s "publik API" section). The
app ships Styleprint's **public** publik app token (`publik-app-token.txt`, safe to
commit: it only mints capped per-install keys and is not itself a usable credential)
and calls `POST /installs` to exchange it for one.

1. Start the app without `STYLEPRINT_MOCK` set.
2. Click "Set up free key" on the first-run banner, or call the same endpoint directly:
   `curl -X POST http://localhost:3001/api/wallet/provision`.
3. Approve the install in the page publik opens.
4. The minted key is written to `~/.styleprint/credential.json` as `installKey` and used
   automatically from then on.

To check the wiring from a built app without the UI:
`PUBLIK_SELF_TEST=1 "<path to the built styleprint binary>"` prints
`publik self-test: ok styleprint <version> (install <id>)`.

### Credential order

Every AI call resolves credentials in this order, enforced in
`server/src/ai/client.ts` and never anywhere else:

1. Your own key (`credential.json`'s `userKey`/`userBaseUrl`, settable from the app).
2. `PUBLIK_API_KEY` / `PUBLIK_API_BASE_URL` environment variables.
3. The per-install key from step 4 above.
4. None of the above → the app asks you to pick one of the two paths.

`STYLEPRINT_MOCK=1` short-circuits all of this.

## Desktop app: building it yourself

The desktop app is a [Tauri](https://tauri.app) shell around the same Express server:
a native window shows a startup page, starts the bundled server on the Node.js runtime
the app ships with, and then points the window at it. The server only listens on
`127.0.0.1` and stops when the app does.

Requirements: a Rust toolchain (`rustc`/`cargo`) on top of the steps above.

```
npm install
npm run desktop:build
```

This builds the web frontend, bundles the server into a single file
(`server/scripts/bundle-desktop.mjs`), downloads the pinned Node.js runtime the app
ships and checks it against nodejs.org's published checksums
(`scripts/fetch-node.mjs`), and runs `tauri build`. Windows installers land in
`src-tauri/target/release/bundle/`:

- `nsis/Styleprint_<version>_x64-setup.exe`
- `msi/Styleprint_<version>_x64_en-US.msi`

macOS builds run on GitHub Actions (`.github/workflows/desktop-release.yml`), since a
`.app` can't be built on Windows: a **universal** `.dmg` (Apple Silicon and Intel in
one file), ad-hoc signed, for macOS 13.5 and later (the bundled Node.js minimum).
Notarization needs a paid Apple Developer ID and is a follow-up (DECISIONS.md #42).

To check an installed copy: `STYLEPRINT_SMOKE_TEST=1 "<installed styleprint binary>"`
starts its bundled server on a throwaway data folder and checks that it answers, opens
its database and serves the UI; `node scripts/e2e-installed.mjs <bundled node>
<server/index.mjs>` runs the full end-to-end flow against it.

The app icon is drawn in `src-tauri/icons/icon-source.svg`; render it to a 1024×1024
`icon-source.png` next to it and run `npm run desktop:icon` to regenerate every size.

## Releasing

1. `node scripts/set-version.mjs <major.minor.patch>`, then refresh the lockfiles with
   `npm install --package-lock-only` and
   `cargo update -p styleprint --manifest-path src-tauri/Cargo.toml`.
2. Commit, tag `v<version>`, and push both.

The release workflow refuses a tag that doesn't match the app's own version. It builds
both platforms, installs every installer on a clean runner, checks each installed copy
with no system Node.js (both halves of the macOS app included), runs the end-to-end
flow against it, and only then publishes a GitHub Release with the installers.

## Development

- `npm run dev` — server + web together.
- `npm run build` — type-checks every workspace and builds the web bundle.
- `npm run check` — runs every gate from the build order (`PROGRESS.md` has the full
  list and real output).
- Individual gates: `npm run test:db`, `test:ingest`, `test:fingerprint`, `test:ai`,
  `test:embeddings`, `test:pipeline`, `test:export`, `test:publik`, `test:e2e`.

## Privacy

- Corpus, profiles, documents and decisions live only in `~/.styleprint/` (SQLite, mode
  `0600`).
- Per rewrite call, only the paragraph, its two neighbours, the style card, and 6-8
  retrieved snippets go to publik. The full corpus is never sent.
- The desktop app's local server listens on `127.0.0.1` only, so nothing on your network
  can reach your corpus or your publik balance.
- No telemetry.
- A `pk_` key never enters the repo. Only the public `pat_` app token does, on purpose.

## License

AGPL-3.0-only. See `LICENSE`.
