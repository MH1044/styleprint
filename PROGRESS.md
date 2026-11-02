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
