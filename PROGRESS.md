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
 RUN  v5.1.0 C:/Users/mhrah/dev/Humaniser/server

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
 RUN  v5.1.0 C:/Users/mhrah/dev/Humaniser/server

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
 RUN  v5.1.0 C:/Users/mhrah/dev/Humaniser/server

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
 RUN  v5.1.0 C:/Users/mhrah/dev/Humaniser/server

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
 RUN  v5.1.0 C:/Users/mhrah/dev/Humaniser/server

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
 RUN  v5.1.0 C:/Users/mhrah/dev/Humaniser/server

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
> @voicebox/shared@0.1.0 build
> tsc -p tsconfig.json --noEmit

> @voicebox/server@0.1.0 build
> tsc -p tsconfig.json --noEmit

> @voicebox/web@0.1.0 build
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
