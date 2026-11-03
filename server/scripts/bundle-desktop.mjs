#!/usr/bin/env node
// Bundles the server into a single CJS file for the Tauri desktop build.
// better-sqlite3 is the one native dependency, so it stays external and its
// package directory is copied alongside the bundle for Node's resolver.

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");
const OUT_DIR = path.join(REPO_ROOT, "src-tauri", "resources", "server");

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(SERVER_ROOT, "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  // ESM, not CJS: several modules compute their own directory from
  // import.meta.url (to find prompts/, the app token, the web build next to
  // the bundle). esbuild leaves import.meta empty when targeting CJS; the
  // .mjs extension forces Node to treat this file as ESM regardless of any
  // nearby package.json, so those resolvers keep working unbundled.
  format: "esm",
  outfile: path.join(OUT_DIR, "index.mjs"),
  external: ["better-sqlite3"],
  logLevel: "info",
  // Some bundled CJS dependencies (e.g. the `debug` package, via express)
  // call require() on Node core modules in a way esbuild can't statically
  // resolve for ESM output. A real `require`, bound to this file via
  // createRequire, is the documented fix for leftover dynamic requires.
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});

// Copy better-sqlite3 (with its prebuilt native binary) next to the bundle
// so require("better-sqlite3") resolves the same way it would in node_modules.
const nodeModulesOut = path.join(OUT_DIR, "node_modules");
fs.mkdirSync(nodeModulesOut, { recursive: true });
fs.cpSync(path.join(REPO_ROOT, "node_modules", "better-sqlite3"), path.join(nodeModulesOut, "better-sqlite3"), {
  recursive: true,
});

// bindings/file-uri-to-path are better-sqlite3's own runtime dependencies.
for (const dep of ["bindings", "file-uri-to-path"]) {
  const src = path.join(REPO_ROOT, "node_modules", dep);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(nodeModulesOut, dep), { recursive: true });
  }
}

// Copy the public app token and prompts/ so the packaged app can still read
// them from next to the bundle, per the resolvers in wallet.ts / prompts.ts.
fs.copyFileSync(path.join(REPO_ROOT, "publik-app-token.txt"), path.join(OUT_DIR, "publik-app-token.txt"));
fs.cpSync(path.join(REPO_ROOT, "prompts"), path.join(OUT_DIR, "prompts"), { recursive: true });

// Copy the built frontend so this one server can serve it directly — the
// desktop build has no separate Vite dev server. Run `npm run build -w web`
// first; resolveWebDistDir() in app.ts looks for it right here.
const webDist = path.join(REPO_ROOT, "web", "dist");
if (!fs.existsSync(path.join(webDist, "index.html"))) {
  throw new Error(`web/dist not found — run "npm run build -w web" before bundling the desktop server.`);
}
fs.cpSync(webDist, path.join(OUT_DIR, "web"), { recursive: true });

console.log(`Desktop server bundle written to ${OUT_DIR}`);
