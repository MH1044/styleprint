import { createApp } from "./app.js";
import { PORT } from "./env.js";
import { selfTest } from "./ai/index.js";

// Builder check for the publik API wiring, run against the built app:
// PUBLIK_SELF_TEST=1 "<built binary>". See https://publikhq.com/skills/setup.md.
if (process.env.PUBLIK_SELF_TEST) {
  const line = await selfTest();
  console.log(line);
  process.exit(line.includes("publik self-test: ok") ? 0 : 1);
}

const app = createApp();

app.listen(PORT, () => {
  console.log(`styleprint server listening on http://localhost:${PORT}`);
});
