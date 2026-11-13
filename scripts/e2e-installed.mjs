#!/usr/bin/env node
// Runs the Playwright end-to-end flow against an installed desktop copy: the
// server bundle and Node.js runtime from the install location, in mock mode
// with a throwaway data folder, outside this repo so nothing can resolve from
// the repo's own node_modules. Used by the release workflow on every
// installer; works locally too.
//
// Usage: node scripts/e2e-installed.mjs <bundled node binary> <server/index.mjs>

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [nodeBinary, serverEntry] = process.argv.slice(2);
if (!nodeBinary || !serverEntry) {
  console.error("usage: node scripts/e2e-installed.mjs <bundled node binary> <server/index.mjs>");
  process.exit(2);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url, child) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`server exited with code ${child.exitCode} while starting`);
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not answer /health within 60s");
}

const port = await freePort();
const url = `http://127.0.0.1:${port}`;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "styleprint-installed-e2e-"));

const server = spawn(nodeBinary, [serverEntry], {
  cwd: os.tmpdir(),
  env: {
    ...process.env,
    PORT: String(port),
    STYLEPRINT_HOST: "127.0.0.1",
    STYLEPRINT_MOCK: "1",
    STYLEPRINT_HOME: home,
  },
  stdio: ["ignore", "inherit", "inherit"],
});

let code = 1;
try {
  await waitForHealth(url, server);
  console.log(`installed server is up at ${url} (${nodeBinary})`);
  code = await new Promise((resolve) => {
    const test = spawn("npx", ["playwright", "test"], {
      cwd: path.join(REPO_ROOT, "web"),
      env: { ...process.env, STYLEPRINT_E2E_URL: url },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    test.on("exit", (c) => resolve(c ?? 1));
  });
} catch (e) {
  console.error(`e2e against the installed copy failed: ${e.message}`);
} finally {
  // Wait for the server to exit first: on Windows its database files stay
  // locked until it has.
  const exited = new Promise((resolve) => (server.exitCode !== null ? resolve() : server.once("exit", resolve)));
  server.kill();
  await exited;
  try {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    console.warn(`could not remove ${home}: ${e.message}`);
  }
}
process.exit(code);
