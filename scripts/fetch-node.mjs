#!/usr/bin/env node
// Downloads the official Node.js runtime that the desktop app ships as a
// Tauri sidecar (bundle.externalBin "binaries/node" in tauri.conf.json), so
// an installed copy never depends on a Node.js the user may not have.
//
// Tauri expects one file per build target, named with the target triple:
// src-tauri/binaries/node-<triple>[.exe]. A universal macOS build needs a
// universal binary, made here by joining the arm64 and x64 builds with lipo.
//
// Usage: node scripts/fetch-node.mjs [--target <triple>]
// Without --target, fetches for the host (what a plain `tauri build` makes).

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The bundled runtime is pinned, and matches the Node the test suite runs on,
// so the app that ships is the app that was tested.
const NODE_VERSION = "24.20.0";
const DIST = `https://nodejs.org/dist/v${NODE_VERSION}`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(REPO_ROOT, "src-tauri", "binaries");

const SOURCES = {
  "x86_64-pc-windows-msvc": [{ file: "win-x64/node.exe" }],
  "aarch64-apple-darwin": [{ file: `node-v${NODE_VERSION}-darwin-arm64.tar.gz` }],
  "x86_64-apple-darwin": [{ file: `node-v${NODE_VERSION}-darwin-x64.tar.gz` }],
  "universal-apple-darwin": [
    { file: `node-v${NODE_VERSION}-darwin-arm64.tar.gz` },
    { file: `node-v${NODE_VERSION}-darwin-x64.tar.gz` },
  ],
};

function hostTriple() {
  const key = `${process.platform}-${process.arch}`;
  const triples = {
    "win32-x64": "x86_64-pc-windows-msvc",
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
  };
  if (!triples[key]) throw new Error(`no bundled Node.js build is set up for ${key}`);
  return triples[key];
}

function parseTarget(argv) {
  const i = argv.indexOf("--target");
  return i === -1 ? hostTriple() : argv[i + 1];
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Fetches one file from the Node.js dist and checks it against SHASUMS256.txt. */
async function fetchVerified(file, shasums) {
  const line = shasums.split("\n").find((l) => l.trim().endsWith(`  ${file}`));
  if (!line) throw new Error(`${file} is not listed in SHASUMS256.txt for v${NODE_VERSION}`);
  const expected = line.trim().split(/\s+/)[0];
  const data = await download(`${DIST}/${file}`);
  const actual = crypto.createHash("sha256").update(data).digest("hex");
  if (actual !== expected) throw new Error(`checksum mismatch for ${file}: expected ${expected}, got ${actual}`);
  return data;
}

/** Writes the node binary for one source into dir and returns its path. */
function extractNode(file, data, dir) {
  if (file.endsWith(".exe")) {
    const out = path.join(dir, "node.exe");
    fs.writeFileSync(out, data);
    return out;
  }
  const archive = path.join(dir, file);
  fs.writeFileSync(archive, data);
  const member = `${file.replace(/\.tar\.gz$/, "")}/bin/node`;
  execFileSync("tar", ["-xzf", archive, "-C", dir, member]);
  return path.join(dir, member);
}

const target = parseTarget(process.argv.slice(2));
const sources = SOURCES[target];
if (!sources) throw new Error(`unsupported target ${target}; expected one of ${Object.keys(SOURCES).join(", ")}`);

const outFile = path.join(OUT_DIR, `node-${target}${target.includes("windows") ? ".exe" : ""}`);
const stampFile = `${outFile}.version`;
if (fs.existsSync(outFile) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8").trim() === NODE_VERSION) {
  console.log(`Node.js v${NODE_VERSION} for ${target} already at ${outFile}`);
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), "styleprint-node-"));
try {
  const shasums = (await download(`${DIST}/SHASUMS256.txt`)).toString("utf8");
  const binaries = [];
  for (const { file } of sources) {
    console.log(`Downloading ${DIST}/${file}`);
    const dir = fs.mkdtempSync(path.join(work, "src-"));
    binaries.push(extractNode(file, await fetchVerified(file, shasums), dir));
  }

  if (binaries.length === 1) {
    fs.copyFileSync(binaries[0], outFile);
  } else {
    execFileSync("lipo", ["-create", "-output", outFile, ...binaries]);
    console.log(execFileSync("lipo", ["-info", outFile]).toString().trim());
  }
  fs.chmodSync(outFile, 0o755);
  fs.writeFileSync(stampFile, `${NODE_VERSION}\n`);
  console.log(`Node.js v${NODE_VERSION} for ${target} written to ${outFile}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
