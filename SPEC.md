# AI Humaniser — Product & Build Spec

Nov 2, 2026 · @MH1044

## Overview

**Voicebox** (working name) is an open-source desktop app that takes a user's own past writing, learns their voice locally, then rewrites AI-generated drafts so they read as if the user wrote them. The AI calls run through [publik API](https://publikhq.com/developers) (OpenAI-compatible, `https://publikhq.com/api/v1`), so users pay pennies per use from a shared publik balance instead of a subscription, and the developer earns a share of each use. Nothing in the pipeline requires a server the developer must host.

End to end: the user drops in 5–50 samples of their writing → the app builds a **style profile** (a local statistical model plus a short learned style card, optionally a small LoRA) → the user pastes an AI draft → pass 1 sends it through publik to loosen the AI patterns (burstiness, hedging, list-itis) → pass 2 sends it again with the style card and nearest-neighbour samples to land it in the user's voice → a **review wizard** walks through every sentence the model flagged as low-confidence → a **document editor** for final touches → export as PDF or Word.

## Goals, non-goals and licensing

The product succeeds if a reader who knows the user cannot tell which paragraphs started as AI output.

**Goals**

- Match the user's voice: sentence length rhythm, vocabulary, punctuation habits, favourite openers, paragraph length, formality.
- Keep the draft's meaning, facts, names, numbers and citations intact. Rewriting never invents.
- Zero accounts, zero developer servers. Style data stays on the user's machine; only the text being rewritten leaves it, to publik.
- Every automated change is reviewable. The wizard shows what was changed and why.
- Cost transparency: show the publik charge after every run and the balance remaining.

**Non-goals (v1)**

- Not a plagiarism tool and not marketed as a detector-evasion tool. See Privacy and ethics.
- No cloud sync, no team features, no browser extension.
- No general-purpose chat. One job, done well.

**Licensing and money**

| Item | Decision |
| --- | --- |
| App licence | AGPL-3.0 (keeps forks open; swap to MIT if the publik listing or contributors prefer) |
| Style models | Trained locally, owned by the user, stored in the user's data folder |
| AI cost | User pays publik per use; the app ships a public `publik-app-token.txt` that mints capped per-install keys |
| Developer revenue | [publik](https://publikhq.com/pricing) splits the margin on each use: half to publik, half to the app developer |
| Own-key path | Always available: user can paste any OpenAI-compatible key and base URL instead (required by publik's listing rules) |

## publik API: what it is and how the user pays

publik is not a humaniser API. It is a metered LLM gateway that any OpenAI- or Anthropic-compatible client can point at, with one shared balance across every publik-listed app. The humanising and restyling logic lives in our prompts and our local style model; publik only supplies the model calls and the billing. Details below are from [publikhq.com/developers](https://publikhq.com/developers) and [/pricing](https://publikhq.com/pricing), as of 2 Nov 2026.

**Endpoints we use** (base `https://publikhq.com/api/v1`, auth `Authorization: Bearer pk_live_…`)

| Endpoint | Used for |
| --- | --- |
| `POST /chat/completions` | Both rewrite passes, the confidence tagging pass, style-card generation (streaming on) |
| `POST /embeddings` | Embedding the user's corpus sentences for nearest-neighbour retrieval (provider price, no markup) |
| `GET /wallet` | Balance, weekly budget, reset time, shown in the app footer |
| `POST /installs` | First launch: mints the per-install `pk_` key from the public `pat_` app token |

**Model tiers** (ask for a tier, never a vendor name; publik swaps the backing model without breaking the app)

| Tier | Typical cost per use | Our use |
| --- | --- | --- |
| `publik-fast` | $0.001 | Confidence tagging, segmenting, style-stat extraction, cleanup |
| `publik-balanced` | $0.01 | Default for both rewrite passes |
| `publik-smart` | $0.018 | Optional “high fidelity” toggle for long or important documents |

**How the user pays.** A fresh install starts at $0.00; linking the computer to a publik account gives $0.05 of free use once. After that: Basic ($8/mo), Pro ($20/mo) or one-off packs ($20/$50/$100) that never expire. One balance works across every publik app. A typical use is about 1,500 words in, 375 out. A full run on a 1,000-word draft costs roughly 3–6 balanced calls, so about $0.03–$0.06.

**What every response tells us.** `x-publik-*` headers carry the model that served the call, the charge, the balance after, this week's usage and budget, and the reset time. We surface these in the UI after every run. An empty balance returns `402` with `error.message` and `error.top_up_url`; the app shows exactly those and nothing else, and keeps the own-key path usable.

**Privacy on the publik side.** Requests go through publik's servers to a shared model account; publik states it does not train on them and stores no request bodies beyond a 24-hour idempotency fingerprint. The model provider's abuse-monitoring retention still applies. Users who want zero third parties use their own key or a local OpenAI-compatible server (Ollama, LM Studio).

## Architecture

&#91;embedded content: pipeline architecture · 7 local stages, 3 publik endpoints\]

Everything that holds the user's writing sits in the left box and never leaves it whole; the right box is a metered model gateway that sees one paragraph and a handful of retrieved snippets per call. The style network is the only part that is ours to build; the rest is wiring and UI.

## Stage 1: Ingest the user's existing writing

The profile is only as good as the corpus, so the ingest screen pushes for at least 3,000 words of the user's own unassisted prose and says so in numbers.

**Accepted inputs:** `.txt`, `.md`, `.docx`, `.pdf` (text layer only), pasted text, and an “import folder” that walks a directory. Each file becomes one *sample* with a title, source path, word count and an optional tag (email, essay, blog, report) so the user can later pick which voice to write in.

**Cleaning (local, no AI calls):**

1. Strip boilerplate: signatures, quoted replies, headers/footers, page numbers, URLs on their own line.
2. Normalise whitespace and smart quotes; keep the user's own quote and dash habits as data, not noise.
3. Split into paragraphs and sentences (a rules-based splitter plus a small abbreviation list; no model needed).
4. Drop samples under 80 words and flag samples that look AI-written themselves (very low burstiness, high list density) with a warning the user can override.
5. Deduplicate near-identical paragraphs.

**Consent and provenance.** Before anything is stored the app states, on screen: the corpus stays in `~/.voicebox/corpus/`, it is never uploaded in full, and only short retrieved snippets (a few sentences per call) are sent to the model as examples during a rewrite. The user ticks a box confirming the writing is theirs or they have the right to use it.

**Minimums and quality gauge.** A live meter shows words ingested against three bands: under 1,500 (profile will be thin), 1,500–8,000 (good), over 8,000 (enough to train a LoRA). The gauge updates as files drop in.

## Stage 2: Build the custom style network

The “network” is three layers that get richer as the corpus grows. Layers 1 and 2 are enough for most users and cost nothing to run; layer 3 is opt-in.

**Layer 1: Style fingerprint (local, statistical).** Computed in pure Python/TypeScript the moment ingest finishes.

| Feature | How measured | Why it matters |
| --- | --- | --- |
| Sentence length | mean, std dev, histogram over 5-word buckets | Burstiness is the single strongest human signal |
| Paragraph length | mean sentences and words per paragraph | AI drafts run uniform; people don't |
| Function-word profile | frequency of the 150 most common English function words | Stable per author, hard to fake consciously |
| Punctuation habits | rate of em dashes, semicolons, parentheses, exclamation marks, Oxford comma yes/no | Cheap, visible, very personal |
| Openers | top 30 sentence-initial words and bigrams | “So,” “Honestly,” “The thing is” |
| Contraction rate | contracted vs expanded forms | Formality dial |
| Vocabulary | type-token ratio, top 200 content words, words the user never uses that LLMs love (delve, tapestry, leverage, crucial) | Builds the *avoid list* |
| Hedging and intensifiers | rate of “perhaps”, “very”, “I think” | Confidence texture |
| Typo and quirk register | repeated non-standard spellings, lowercase i, double spaces | Kept as optional “quirks” toggle |

Output: `style.json` with every stat plus derived targets (e.g. “aim for mean 17 words, std 9; one sentence under 6 words per paragraph”).

**Layer 2: Retrieval index + style card.** Every corpus sentence (and paragraph) is embedded via `POST /embeddings` once and stored in a local SQLite table with `sqlite-vec`. At rewrite time the app pulls the 6–8 nearest user paragraphs to each draft paragraph and sends them as examples. Separately, one `publik-balanced` call reads 20 random paragraphs plus `style.json` and writes a 250-word **style card**: a plain-English description of the voice (“Short declaratives. Starts arguments with a concession. Never uses semicolons. Jokes once per section, dry.”). The user can edit the card by hand; it is the most leverage-per-token in the whole system.

**Layer 3 (optional): Local LoRA.** With 8,000+ words, the app offers to fine-tune a LoRA adapter on a small open model (Qwen2.5-1.5B or Llama-3.2-3B via `mlx` on Apple silicon, `peft` + `bitsandbytes` on CUDA, CPU fallback with a warning about time). Training pairs are built automatically: ask `publik-fast` to produce a flat, neutral paraphrase of each user paragraph, then train neutral → user's original. The adapter runs locally as a **final polish pass** after publik's pass 2, or as a fully offline mode for users who refuse any cloud call. It never replaces layers 1–2; it sharpens them.

**Multiple voices.** A user can hold several profiles (work email, personal blog, academic). Each is a folder under `~/.voicebox/profiles/<name>/` with its own `style.json`, index and card.

## Stage 3: Humanise via publik, then restyle to the user's voice

Two passes, both over publik, both paragraph-by-paragraph with a sliding window of context, so a 3,000-word draft never hits one giant prompt and each call stays a cheap “typical use”.

**Pre-processing (local).** Segment the draft into paragraphs; protect anything that must not change by wrapping it in `⟦keep⟧…⟦/keep⟧`: numbers, dates, proper nouns, quotes, citations, code, URLs. Build a *facts list* per paragraph (every entity and number) for the post-check.

**Pass 1: De-AI (`publik-balanced`).** Input: the paragraph, one paragraph either side, the user's avoid list from `style.json`. Instruction: keep every fact, break the uniform rhythm, remove hedging stacks, convert reflexive bullet lists back to prose where the user's corpus is prose-heavy, kill the LLM vocabulary, no intro or summary sentences. Output: rewritten paragraph only.

**Pass 2: Voice (`publik-balanced`, or `publik-smart` if the user toggles high fidelity).** Input: pass-1 paragraph, the style card, the numeric targets, and the 6–8 nearest paragraphs from the user's corpus retrieved by embedding. Instruction: rewrite so it sits next to the examples without copying any phrase longer than four words from them. Output: the paragraph plus a one-line JSON tail: `{"confidence":0.0–1.0,"changed":["…"],"unsure":["…"]}` where `unsure` lists spans the model would want a human to look at (tone calls, ambiguous facts, places it had to guess intent).

**Pass 3 (optional, local).** If a LoRA exists, run the paragraph through it with a low temperature as a polish; diff against pass 2 and accept only changes that keep the facts list intact.

**Post-check (local, then one `publik-fast` call).** For each paragraph: facts list still present, word count within ±30%, no `⟦keep⟧` span altered, stats of the whole output moved toward the user's targets (sentence-length std dev, contraction rate, avoid-list hits = 0). Any paragraph that fails a check is re-run once with the failure named in the prompt; if it fails again it is marked **needs review** and goes to the wizard unchanged.

**Scoring the output.** The app computes the same Layer-1 fingerprint on the result and shows a *voice match* figure (cosine similarity of the feature vector to the profile, 0–100) next to the before figure. That is the honest metric; the app does not run or quote third-party AI detectors.

**Cost and progress.** A progress bar per paragraph, with the running publik charge from `x-publik-charge-micros` and the balance after. Cancel at any time keeps the paragraphs already done.

## Stage 4: Review wizard for low-confidence passages

The wizard turns every `unsure` span and every **needs review** paragraph into a card the user resolves in under ten seconds. Nothing reaches the editor until the queue is empty or the user explicitly skips the rest.

**Queue order.** Needs-review paragraphs first, then `unsure` spans sorted by confidence ascending, then paragraphs whose voice match fell below 60.

**Card layout (one per item).**

- Left: the original AI draft span, greyed. Right: the rewritten span, with the changed words highlighted.
- One line from the model: *why* it was unsure (“I couldn't tell if this was sarcastic”, “two possible readings of 'their'”, “the number 14% appeared twice with different meanings”).
- The two nearest corpus examples it leaned on, collapsed, so the user sees where the voice came from.

**Actions (keyboard: 1–5, Enter, Esc).**

1. **Keep** the rewrite.
2. **Revert** to the original span.
3. **Try again** with a one-line steer (“more blunt”, “this is a joke”, “keep the list”). One `publik-balanced` call, shown inline, charge shown.
4. **Edit** in place, plain textarea.
5. **Blend** the two with a slider (local: picks sentence-by-sentence from either side).

**Learning from decisions.** Every Keep/Revert/Edit is logged to `decisions.jsonl` in the profile. After 20+ decisions the app regenerates the style card with a “what the user corrected” appendix, so the next run makes the same mistake less. Reverts that touch the avoid list add the word back to the allowed set; edits that add a phrase three times promote it to a favourite.

**Exit.** A summary: items kept, reverted, edited, retried; total publik spend for the wizard; the final voice-match score. Button: **Open in editor**.

## Stage 5: Document editor for final touches

A single-document editor built on [Tiptap](https://tiptap.dev) (ProseMirror), chosen because it is MIT-licensed, handles headings, lists, tables and footnotes, and exports a clean JSON tree that maps directly to both DOCX and HTML-for-PDF.

**What it keeps from the pipeline.**

- A per-paragraph provenance mark: original, rewritten, reverted, hand-edited. Toggle a *heat view* that tints paragraphs by voice match.
- The before/after diff on hover for any rewritten paragraph; one click restores the original.
- Structure from the draft: headings, lists, tables, block quotes, links and footnotes survive the rewrite because the pipeline only rewrites text runs inside each block, never the block types themselves.

**Editor tools.**

- Selection → right-click → **Rewrite in my voice** / **Make shorter** / **Make it plainer** / **Undo AI changes here**. Each is one publik call on the selection only, charge shown in the status bar.
- **Voice check** button: recomputes the Layer-1 fingerprint on the current text and shows the match score plus the three stats furthest from target (“sentences too uniform: std 4 vs your 9”).
- Word and character count, reading time, the avoid-list hits underlined with a dotted line.
- Autosave every 2 seconds to `~/.voicebox/documents/<id>.json`, with a version list (every wizard exit and every export is a named snapshot).
- Find and replace, undo history across sessions, spellcheck via the OS.

**What it does not do.** No comments, no track changes, no collaboration. Those belong in Word or Google Docs after export.

## Stage 6: Export to PDF and Word

Both exports are generated locally from the editor's JSON tree; no publik call and no network.

| Format | Library | Notes |
| --- | --- | --- |
| `.docx` | [docx](https://github.com/dolanmiu/docx) (MIT, TypeScript) | Real Word styles (Heading 1–3, List Paragraph, Quote), real tables, footnotes, page numbers. Opens cleanly in Word, Pages, LibreOffice, Google Docs. |
| `.pdf` | Tauri's WebView print-to-PDF of a print stylesheet (fallback: `pdf-lib`) | Letter/A4 toggle, margins, header/footer with title and page x of y, embedded fonts. |
| `.md` / `.txt` | built-in | For people pasting into something else. |
| Copy as rich text | built-in | Clipboard HTML, for email clients. |

**Export dialog fields:** filename, page size, font family (default: the system serif; the user can pick), font size, line spacing, include title page yes/no, include a “drafted with AI assistance” footer line (off by default, one click on).

**Metadata.** The app writes author = the profile name the user typed, and strips any “Generated by” or model strings. It writes nothing hidden: no watermarks, no steganographic markers, no hidden text.

**Snapshot.** Every export saves a named version in the document's history, so the user can diff later exports against earlier ones.

## Tech stack, repo layout and data model

Desktop-first with Tauri so the app is small, cross-platform, and matches publik's “people install and run it themselves” model where the public app token is committed to the repo.

| Layer | Choice | Why |
| --- | --- | --- |
| Shell | Tauri 2 (Rust) | 10 MB installer, native file dialogs, print-to-PDF, secure credential storage |
| UI | React + TypeScript + Tailwind | Fast to build, huge contributor pool |
| Editor | Tiptap | See Stage 5 |
| Local DB | SQLite via `tauri-plugin-sql` + `sqlite-vec` | Corpus, embeddings, documents, decisions, all in one file |
| Style stats | TypeScript module `@voicebox/fingerprint` | Pure functions, unit-tested, also published to npm for reuse |
| AI client | `openai` npm SDK pointed at publik's base URL | publik's `publik.ts` reference module handles key provisioning |
| LoRA (optional) | Python sidecar: `mlx-lm` (macOS) / `peft` (CUDA) | Spawned only when the user opts in; ships as a separate download |
| Packaging | GitHub Actions → signed builds for macOS, Windows, Linux; listed on publik | publik's publish skill lists it from the repo |

**Repo layout**

```
voicebox/
  src/                     React app
    pipeline/              segment, protect, pass1, pass2, postcheck
    fingerprint/           style stats (pure TS)
    wizard/                review cards and keyboard flow
    editor/                Tiptap setup, provenance marks, export
    publik/                publik.ts reference module + wallet UI
    prompts/               every prompt as a .md file with a version header
  src-tauri/               Rust shell, SQLite, print-to-PDF, credential store
  sidecar-lora/            optional Python trainer
  publik-app-token.txt     public pat_ token, committed on purpose
  AGENTS.md                publik block + repo conventions for coding agents
  prompts/                 same as src/prompts, symlinked, so agents find them
```

**Data model (SQLite)**

| Table | Key columns |
| --- | --- |
| `profiles` | id, name, created\_at, style\_json, style\_card, lora\_path |
| `samples` | id, profile\_id, title, source\_path, tag, text, word\_count, flagged\_ai |
| `chunks` | id, sample\_id, kind (sentence/paragraph), text, embedding (vec) |
| `documents` | id, profile\_id, title, draft\_text, editor\_json, voice\_match, created\_at |
| `paragraphs` | id, document\_id, idx, original, pass1, pass2, final, confidence, unsure\_json, status |
| `decisions` | id, document\_id, paragraph\_id, action, steer, created\_at |
| `versions` | id, document\_id, label, editor\_json, created\_at |
| `spend` | id, document\_id, call, tier, charge\_micros, balance\_after, created\_at |

**publik setup prompt** (from publik's developer page):

```
Add publik API to my app (publik slug: voicebox): ask for a tier slug (publik-fast/balanced/smart), pick the cheapest one the task needs, and write the publik log line. Fetch https://publikhq.com/skills/api.md with curl and follow it step by step.
```

The client-selection order the module enforces: user's own key → `PUBLIK_API_KEY` env → per-install credential file → first-launch provisioning via `POST /installs` → ask for own key if declined.

## First build plan

The first build trades the Tauri shell and the LoRA sidecar for pieces that can be finished and verified end to end with no manual steps. Everything in the stages above still applies; where this section and the Tech stack table disagree, this section wins for the first build.

**Substitutions for the first build**

| Original | First-build choice | Why |
| --- | --- | --- |
| Tauri 2 shell | Node 20 + Express backend, React + Vite frontend, started with `npm run dev`; opens `http://localhost:5173` | No Rust toolchain, no signing, no native dialogs to debug. Tauri wrap is a follow-up. |
| `sqlite-vec` | `better-sqlite3` with embeddings stored as JSON arrays; cosine similarity in JS | Corpus is at most a few thousand chunks; brute force is instant and has no native build risk |
| Print-to-PDF via WebView | Browser `window.print()` with a `@media print` stylesheet, plus a server-side fallback using `pdf-lib` for plain text | Zero extra dependencies, works everywhere |
| LoRA sidecar | Not built. A `profiles.lora_path` column and a disabled toggle with tooltip “coming in M4” | Needs GPU-specific setup and hours of training; cannot be verified in the first build |
| publik device-flow provisioning | The `publik.ts` module is copied in and wired, but the token mint is left as a documented step in `README.md`; tests run with `VOICEBOX_MOCK=1` and, if `PUBLIK_API_KEY` is set, one real call | The mint needs a human to approve in a browser mid-flow |
| Embeddings from publik | Primary. Fallback to local TF-IDF vectors if `/embeddings` errors or mock mode is on | Pipeline never blocks on the embeddings endpoint |

**Mock mode.** `VOICEBOX_MOCK=1` makes the AI client return deterministic rewrites (shuffle sentence order within the paragraph, contract a few verbs, append the JSON tail with confidence 0.6 and one `unsure` span) so every screen, the wizard and the exports can be exercised end to end with no key and no spend.

**Build order with gates.** Each step ends with a command that must pass before the next step starts.

1. Scaffold: monorepo with `server/` and `web/`, shared `types.ts`, `npm run dev` starts both. Gate: `curl localhost:3001/health` returns `{ok:true}`.
2. SQLite schema from the data model, migrations on boot. Gate: `npm run test:db` creates and reads one row per table.
3. Ingest: upload route for txt/md/docx/pdf (`mammoth`, `pdf-parse`), cleaning, sentence splitter, dedupe, AI-looking warning. Gate: `npm run test:ingest` on `fixtures/corpus/*.md` yields word counts and chunk counts.
4. Fingerprint module, pure functions, with the full feature table. Gate: `npm run test:fingerprint` on fixtures produces `style.json` and the derived targets; cosine of a text against itself is 1.0.
5. AI client: publik base URL, own-key override, mock mode, `x-publik-*` header capture, 402 handling. Gate: `npm run test:ai` in mock mode returns a rewrite with a parseable JSON tail.
6. Embedding index and retrieval with TF-IDF fallback. Gate: nearest-neighbour of a fixture paragraph returns itself first.
7. Style card generation and the two-pass pipeline with protect spans, post-check and single retry. Gate: `npm run test:pipeline` rewrites `fixtures/draft.md` in mock mode, keeps every number and name, and raises the voice-match score.
8. Frontend: Profiles, Ingest (with meter), Rewrite (progress and spend), Wizard (cards, keyboard 1–5), Editor (Tiptap, provenance marks, selection rewrites, voice check), Export dialog. Gate: `npm run build` passes with no type errors; a Playwright smoke test walks ingest → rewrite → wizard → editor → export in mock mode.
9. Export: `.docx` via `docx`, PDF via print stylesheet, `.md`, rich-text copy. Gate: the exported `.docx` opens with `mammoth` round-trip and contains the headings; the `.md` matches the editor text.
10. publik wiring: `publik.ts` module, client order, first-run card, 402 card, `AGENTS.md` block, `README.md` with the token-mint step. Gate: if `PUBLIK_API_KEY` is set, one real `publik-fast` call prints its charge header; otherwise the mock gate from step 5.
11. Final: `README.md` (install, run, mock mode, own key, publik), `LICENSE` (AGPL-3.0), `prompts/*.md` with version headers, `npm run check` running every gate in sequence.

**Definition of done.** `git clone` → `npm install` → `VOICEBOX_MOCK=1 npm run dev` → a new user can drop in three markdown files, paste a draft, finish the wizard, edit, and download a `.docx` and a PDF, with no key and no network. `npm run check` is green.

## Master prompts

These ship in `prompts/` as versioned files. Placeholders in `{braces}` are filled by the pipeline. Temperature 0.7 for pass 1, 0.5 for pass 2, 0 for tagging.

**Pass 1: de-AI**

```markdown
You are an editor removing machine-generated texture from one paragraph.

Rules, in priority order:
1. Keep every fact, number, name, date, quotation and claim exactly. Anything inside ⟦keep⟧ ⟦/keep⟧ is copied through untouched.
2. Keep the meaning and the paragraph's job in the document (it sits between the context paragraphs below).
3. Vary sentence length. Mix long sentences with a short one. Do not start three sentences in a row the same way.
4. Remove stacked hedges, throat-clearing openers, summary sentences that restate the paragraph, and transition words used as filler.
5. Never use these words or their forms: {avoid_list}.
6. Do not add new information, examples, or opinions.
7. Match the length within 20%. Output only the rewritten paragraph. No preamble, no notes.

Previous paragraph (context only): {prev}
Next paragraph (context only): {next}

Paragraph to rewrite:
{paragraph}
```

**Pass 2: voice**

```markdown
You are rewriting one paragraph so it reads as if written by a specific person. You have a description of how they write and real examples of their writing.

How they write:
{style_card}

Measured targets: mean sentence length {mean_len} words (spread {std_len}); contractions {contraction_rate}; em dashes {dash_rate} per 100 words; semicolons {semi_rate}; favourite openers: {openers}. Never use: {avoid_list}.

Examples of their writing on nearby topics (do not copy any phrase longer than four words from them):
{retrieved_examples}

Rules:
1. Every fact, number, name and ⟦keep⟧ span survives exactly.
2. Rewrite the sentences, not the argument.
3. Prefer the person's habits over generic good style. If they ramble a little, ramble a little.
4. Length within 20% of the input.

Paragraph:
{paragraph}

Respond with the rewritten paragraph, then on the final line a JSON object and nothing after it:
{"confidence": <0 to 1, how sure you are this sounds like them and kept the meaning>, "changed": [<up to 3 short notes on what you changed and why>], "unsure": [<spans a human should check, each with a 10-word reason>]}
```

**Style card generation** (once per profile, `publik-balanced`)

```markdown
Below are measured statistics and 20 paragraphs written by one person. Write a 200–250 word description of how this person writes, addressed to an editor who must imitate them. Be concrete: name habits, favourite constructions, what they avoid, how they open and close paragraphs, their register and humour. Do not praise or judge. Do not quote more than four consecutive words from the samples.

Statistics: {style_json_summary}
Samples: {samples}
```

**Post-check retry suffix** (appended to pass 1 or 2 on failure)

```markdown
The previous attempt failed this check: {failure}. Fix only that, keeping everything else.
```

## Privacy, ethics and acceptable use

The app is positioned as a voice tool for people who use AI to draft their own work, and the README, listing and in-app copy say so. It is not sold as a way to pass AI-detection checks, and it does not integrate, run or quote any detector.

**Data**

- Corpus, profiles, documents and decisions live only in `~/.voicebox/` (SQLite, mode 0600). One “Delete everything” button wipes it.
- Per call, only the paragraph being rewritten, its two neighbours, the style card and 6–8 retrieved snippets go to publik. The full corpus is never sent. The exact payload of the last call is viewable in Settings → Last request.
- Keys are stored in the OS keychain through Tauri, never logged, never in argv. A `pk_` key never enters the repo.
- No telemetry. Crash reports are opt-in and contain no text.

**Acceptable use, shown once at first run and in the README**

- Use it on writing you are allowed to submit as your own, in contexts where AI assistance is allowed. Many universities and employers forbid it; that is the user's responsibility and the app says so plainly.
- Do not build a profile from someone else's writing to impersonate them. The ingest consent box asks the user to confirm the samples are theirs or licensed to them.
- The “drafted with AI assistance” export footer exists so disclosure is one click.

**What the app refuses to do.** It will not remove or alter a disclosure line the user added, it will not strip author metadata from a document it did not create, and the prompts forbid inventing facts, sources or quotes.

**Licence note for contributors.** AGPL means any hosted fork must publish its source. That is intentional: the point of the project is that nobody rents the user their own voice.

## Build roadmap and open questions

Four milestones; each one is a usable app on its own and a listing update on publik.

| Milestone | Scope | Done when |
| --- | --- | --- |
| M1 Core loop (weeks 1–3) | Ingest, Layer-1 fingerprint, style card, pass 1 + pass 2, plain textarea output, publik wiring with own-key fallback, 402 handling | A 1,000-word draft comes back in the user's voice for under $0.06 and the voice-match score rises |
| M2 Wizard (weeks 4–5) | Confidence tail, review cards, keyboard flow, decisions log, card regeneration from decisions | Every `unsure` span is resolvable without leaving the keyboard |
| M3 Editor + export (weeks 6–8) | Tiptap editor, provenance marks, selection rewrites, DOCX and PDF export, versions | Exported .docx opens cleanly in Word and Google Docs with headings and footnotes intact |
| M4 Local network (weeks 9–12) | `sqlite-vec` retrieval, LoRA sidecar on macOS first, offline mode, multiple profiles | A user with 8k+ words can run the whole pipeline with no network |

**Open questions**

- [ ] Name. “Voicebox” is a placeholder; check publik and npm for collisions.
- [ ] AGPL vs MIT. AGPL protects against hosted forks; MIT gets more contributors. Decide before the first public commit.
- [ ] Does publik's `/embeddings` tier expose an embedding model name, and what dimension? Confirm from `GET /models` before locking the vec column size.
- [ ] Which `publik-smart` cases justify 1.8× the cost of balanced? Run a 20-document blind comparison in M1 and keep the toggle only if reviewers prefer smart.
- [ ] Windows PDF path: WebView2 print-to-PDF is fine on recent Windows; test on Windows 10 LTSC or fall back to `pdf-lib`.
- [ ] Should the style card be editable mid-run, or only between runs? Leaning only between runs, to keep paragraph results comparable.
- [ ] Non-English corpora: Layer 1's function-word list is English-only; parameterise by language in M4.

**Sources**

- [publik developers page](https://publikhq.com/developers): endpoints, tiers, headers, privacy statement
- [publik pricing](https://publikhq.com/pricing): plans, per-use costs, revenue split
- [publik api.md skill](https://publikhq.com/skills/api.md): provisioning flow, client order, AGENTS.md block
