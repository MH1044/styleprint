#!/usr/bin/env node
// Sets the app's version everywhere it is recorded, so a release tag, the
// installer file names and the version the app reports to publik all agree.
//
// Usage: node scripts/set-version.mjs 0.1.2           set it, then refresh the lockfiles
//        node scripts/set-version.mjs --check 0.1.2   fail unless every place already says it

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args[0] === "--check";
const version = check ? args[1] : args[0];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("usage: node scripts/set-version.mjs [--check] <major.minor.patch>");
  process.exit(2);
}

/** Each place the version lives: the file and the pattern whose first group is the version. */
const PLACES = [
  ...["package.json", "shared/package.json", "server/package.json", "web/package.json"].map((file) => ({
    file,
    pattern: /("version":\s*")([^"]+)(")/,
  })),
  { file: "server/package.json", pattern: /("@styleprint\/shared":\s*")([^"]+)(")/ },
  { file: "web/package.json", pattern: /("@styleprint\/shared":\s*")([^"]+)(")/ },
  { file: "src-tauri/tauri.conf.json", pattern: /("version":\s*")([^"]+)(")/ },
  { file: "src-tauri/Cargo.toml", pattern: /(\[package\][^[]*?\nversion\s*=\s*")([^"]+)(")/ },
  { file: "server/src/ai/client.ts", pattern: /(export const APP_VERSION = ")([^"]+)(")/ },
];

const mismatches = [];
for (const { file, pattern } of PLACES) {
  const full = path.join(ROOT, file);
  const text = fs.readFileSync(full, "utf8");
  const match = pattern.exec(text);
  if (!match) throw new Error(`no version found in ${file} for ${pattern}`);
  if (match[2] === version) continue;
  if (check) mismatches.push(`${file}: ${match[2]}`);
  else fs.writeFileSync(full, text.replace(pattern, (_, a, _old, c) => `${a}${version}${c}`));
}

if (check) {
  if (mismatches.length) {
    console.error(`version ${version} expected, but:\n  ${mismatches.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`every recorded version is ${version}`);
} else {
  console.log(`version set to ${version}; refresh the lockfiles with:
  npm install --package-lock-only
  cargo update -p styleprint --manifest-path src-tauri/Cargo.toml`);
}
