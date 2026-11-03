import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Outside the repo on purpose: Vite watches the whole web/ root, and
// better-sqlite3's WAL files under a repo-local data dir would trigger a
// full page reload (and lose test state) on every database write.
const VOICEBOX_HOME = path.join(os.tmpdir(), "voicebox-e2e-home");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev -w server",
      cwd: path.resolve(__dirname, ".."),
      url: "http://localhost:3002/health",
      reuseExistingServer: false,
      env: {
        VOICEBOX_MOCK: "1",
        VOICEBOX_HOME,
        PORT: "3002",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run dev -w web -- --port 5174",
      cwd: path.resolve(__dirname, ".."),
      url: "http://localhost:5174",
      reuseExistingServer: false,
      env: {
        VOICEBOX_MOCK: "1",
        VOICEBOX_API_PROXY: "http://localhost:3002",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
