# Styleprint

Styleprint takes your own past writing, builds a local style profile from it, and
rewrites AI-generated drafts so they read in your voice. The AI calls run through
[publik](https://publikhq.com/developers), a metered LLM gateway, so you pay cents per
use instead of a subscription. Your writing never leaves your machine — only the
paragraph being rewritten, a couple of neighbours, and a handful of retrieved examples
go to the model per call.

See `SPEC.md` for the full product spec and `DECISIONS.md` for every build-time choice
made where the spec was silent.

## 1. Install

```
git clone <this repo>
cd styleprint
npm install
```

Node 22+ is required (`better-sqlite3`'s declared minimum — see DECISIONS.md #43).
No native build step needed — `better-sqlite3` ships a prebuilt binary for your
platform directly in the package (DECISIONS.md #44).

## 2. Run in mock mode (no key, no network, no spend)

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

## 3. Run for real: bring your own key

Any OpenAI-compatible endpoint works — publik itself, or a local server like Ollama or
LM Studio. In the app, the "No publik key yet" banner on first run lets you paste a key
and (optionally) a base URL; it's saved to `~/.styleprint/credential.json` (mode `0600`)
and never leaves your machine except as the `Authorization` header on each call.

Without the UI, set the environment variable instead:

```
PUBLIK_API_KEY=pk_live_your_key npm run dev
```

## 4. Run for real: mint a free per-install publik key

This is the path the app ships for people who don't want to paste a key by hand. A
fresh install starts at $0.00; linking the install to a publik account gives $0.05 of
free use once, with paid plans after that (see `SPEC.md`'s "publik API" section). The
app ships a **public** app token (`publik-app-token.txt`, safe to commit — it only
mints capped per-install keys, it is not itself a usable credential) and calls
`POST /installs` to exchange it for one.

The real mint needs a human to approve something in a browser mid-flow, so this build
leaves it as a manual step rather than fully automating it:

1. Make sure `publik-app-token.txt` at the repo root holds your project's real `pat_`
   token (the placeholder value shipped here, `pat_REPLACE_WITH_REAL_PUBLIK_APP_TOKEN_BEFORE_LISTING`,
   is not usable — replace it before you rely on this path).
2. Start the app without `STYLEPRINT_MOCK` set.
3. Click "Set up free key" on the first-run banner, or call the same endpoint directly:
   `curl -X POST http://localhost:3001/api/wallet/provision`.
4. Approve the install in whatever page publik opens (device-flow / browser approval).
5. The minted key is written to `~/.styleprint/credential.json` as `installKey` and used
   automatically from then on.

## Credential order

Every AI call resolves credentials in this order, enforced in
`server/src/ai/client.ts` and never anywhere else:

1. Your own key (`credential.json`'s `userKey`/`userBaseUrl`, settable from the app).
2. `PUBLIK_API_KEY` / `PUBLIK_API_BASE_URL` environment variables.
3. The per-install key from step 4 above.
4. None of the above → the app asks you to pick one of the two paths.

`STYLEPRINT_MOCK=1` short-circuits all of this.

## Desktop installer (Windows)

Styleprint also builds as a real installable desktop app via [Tauri](https://tauri.app):
a native window that spawns the same Express server this repo already has, waits for
it to come up, and points the window at it. No browser tab, no terminal, no typing
`npm run dev` — just an installer and a Start Menu entry.

Requirements beyond the web-app path: a Rust toolchain (`rustc`/`cargo`) and, for now,
**Node.js must already be installed on the machine the installer runs on** — the
installer bundles the server's own code but still launches it with `node` from PATH
(see `DECISIONS.md` #33 for the follow-up that would remove this requirement).

```
npm install
npm run desktop:build
```

This builds the web frontend, bundles the server into a single file
(`server/scripts/bundle-desktop.mjs`), and runs `tauri build`. Installers land in
`src-tauri/target/release/bundle/`:

- `nsis/Styleprint_<version>_x64-setup.exe`
- `msi/Styleprint_<version>_x64_en-US.msi`

Both install a normal Windows app: Start Menu entry, uninstaller, no admin terminal
required. Data still lives in `~/.styleprint/` on whichever machine it's installed on —
see "Credential order" below; nothing about the desktop wrap changes where data lives.

To regenerate the app icon from a new source image:
`npm run desktop:icon` (reads `src-tauri/icons/icon-source.png`).

### macOS

Built via GitHub Actions (`.github/workflows/desktop-release.yml`), not locally — there's
no Mac in this project's build environment. Push a tag matching `v*.*.*` (or run the
workflow manually from the Actions tab) and it builds a **universal** `.dmg`/`.app`
(one file, runs natively on both Apple Silicon and Intel) alongside the Windows
installers, and uploads them as workflow artifacts.

**Unsigned for now** — no Apple Developer account is configured. macOS's Gatekeeper
will refuse to open it with "app is damaged" or similar. To run it anyway, users
either right-click the app → Open (and confirm) the first time, or run:

```
xattr -cr /Applications/Styleprint.app
```

Signing and notarization are a follow-up once there's a Developer ID to sign with
(DECISIONS.md #38).

## Development

- `npm run dev` — server + web together.
- `npm run build` — type-checks every workspace and builds the web bundle.
- `npm run check` — runs every gate from the build order (`PROGRESS.md` has the full
  list and real output from the last run of each).
- Individual gates: `npm run test:db`, `test:ingest`, `test:fingerprint`, `test:ai`,
  `test:embeddings`, `test:pipeline`, `test:export`, `test:publik`, `test:e2e`.

## Privacy

- Corpus, profiles, documents and decisions live only in `~/.styleprint/` (SQLite, mode
  `0600`).
- Per rewrite call, only the paragraph, its two neighbours, the style card, and 6-8
  retrieved snippets go to publik. The full corpus is never sent.
- No telemetry.
- A `pk_` key never enters the repo. Only the public `pat_` app token does, on purpose.

## License

AGPL-3.0-only. See `LICENSE`.
