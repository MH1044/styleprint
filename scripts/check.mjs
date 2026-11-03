#!/usr/bin/env node
// Runs every gate from "Build order with gates" in SPEC.md, in sequence.
// Fails fast: the first non-zero exit stops the run.

import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

function run(cmd) {
  const result = spawnSync(cmd, { shell: true, stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    throw new Error(`command failed (exit ${result.status}): ${cmd}`);
  }
}

async function healthCheck() {
  const child = spawn("npm run dev", {
    shell: true,
    env: { ...process.env, VOICEBOX_MOCK: "1" },
    stdio: "ignore",
  });

  try {
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      await delay(1000);
      try {
        const res = await fetch("http://localhost:3001/health");
        if (res.ok) {
          const body = await res.json();
          if (body.ok === true) {
            healthy = true;
            break;
          }
        }
      } catch {
        // server not up yet, keep polling
      }
    }
    if (!healthy) throw new Error("server did not report {ok:true} on /health within 30s");
    console.log("curl localhost:3001/health -> {\"ok\":true}");
  } finally {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
    await delay(500);
  }
}

const steps = [
  { name: "1: scaffold (health check)", fn: healthCheck },
  { name: "2: db schema", cmd: "npm run test:db" },
  { name: "3: ingest", cmd: "npm run test:ingest" },
  { name: "4: fingerprint", cmd: "npm run test:fingerprint" },
  { name: "5: ai client", cmd: "npm run test:ai" },
  { name: "6: embeddings and retrieval", cmd: "npm run test:embeddings" },
  { name: "7: style card and pipeline", cmd: "npm run test:pipeline" },
  { name: "8: frontend (build + e2e)", cmd: "npm run build && npm run test:e2e" },
  { name: "9: export", cmd: "npm run test:export" },
  { name: "10: publik wiring", cmd: "npm run test:publik" },
];

for (const step of steps) {
  console.log(`\n=== Gate ${step.name} ===`);
  if (step.fn) {
    await step.fn();
  } else {
    run(step.cmd);
  }
}

console.log("\nAll eleven gates passed.");
