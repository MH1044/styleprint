import { createApp } from "./app.js";
import { PORT, listenHost } from "./env.js";
import { selfTest } from "./ai/index.js";

// Builder check for the publik API wiring, run against the built app:
// PUBLIK_SELF_TEST=1 "<built binary>". See https://publikhq.com/skills/setup.md.
if (process.env.PUBLIK_SELF_TEST) {
  const line = await selfTest();
  console.log(line);
  process.exit(line.includes("publik self-test: ok") ? 0 : 1);
}

// The desktop shell holds this process's stdin open for as long as it runs.
// When the shell exits, normally or not, the pipe closes and the server
// follows, so it never lingers in the background holding the port or (on
// Windows) locking the installed files against an upgrade.
if (process.env.STYLEPRINT_EXIT_WITH_PARENT) {
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("error", () => process.exit(0));
  process.stdin.resume();
}

const app = createApp();
const host = listenHost();

const onListening = () => {
  console.log(`styleprint server listening on http://${host ?? "localhost"}:${PORT}`);
};
if (host) app.listen(PORT, host, onListening);
else app.listen(PORT, onListening);
