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
