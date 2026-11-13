import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Outside the repo on purpose: Vite watches the whole web/ root, and
// better-sqlite3's WAL files under a repo-local data dir would trigger a
// full page reload (and lose test state) on every database write.
const STYLEPRINT_HOME = path.join(os.tmpdir(), "styleprint-e2e-home");

// Set STYLEPRINT_E2E_URL to run the same flow against a server that's already
// running (an installed desktop copy's bundled server, in mock mode) instead of
// starting the dev servers. That is how release builds are checked end to end.
const externalUrl = process.env.STYLEPRINT_E2E_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: externalUrl ?? "http://localhost:5174",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: externalUrl
    ? undefined
    : [
        {
          command: "npm run dev -w server",
          cwd: path.resolve(__dirname, ".."),
          url: "http://localhost:3002/health",
          reuseExistingServer: false,
          env: {
            STYLEPRINT_MOCK: "1",
            STYLEPRINT_HOME,
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
            STYLEPRINT_MOCK: "1",
            STYLEPRINT_API_PROXY: "http://localhost:3002",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      ],
});
