import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Every path and flag here is read live from process.env rather than frozen
// at import time, so tests can redirect STYLEPRINT_HOME / toggle STYLEPRINT_MOCK
// per-case without worrying about ESM import hoisting order.

export function styleprintHome(): string {
  return process.env.STYLEPRINT_HOME ?? path.join(os.homedir(), ".styleprint");
}
export function corpusDir(): string {
  return path.join(styleprintHome(), "corpus");
}
export function documentsDir(): string {
  return path.join(styleprintHome(), "documents");
}
export function dbPath(): string {
  return path.join(styleprintHome(), "styleprint.sqlite");
}
export function credentialFilePath(): string {
  return path.join(styleprintHome(), "credential.json");
}

export function ensureDirs(): void {
  for (const dir of [styleprintHome(), corpusDir(), documentsDir()]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export const PORT = Number(process.env.PORT ?? 3001);

export function isMockMode(): boolean {
  return process.env.STYLEPRINT_MOCK === "1";
}
export function publikApiBaseUrl(): string {
  return process.env.PUBLIK_API_BASE_URL ?? "https://publikhq.com/api/v1";
}
export function publikApiKey(): string | null {
  return process.env.PUBLIK_API_KEY ?? null;
}
/** Overrides reading publik-app-token.txt off disk, per the publik.ts reference. */
export function publikAppTokenEnv(): string | null {
  return process.env.PUBLIK_APP_TOKEN?.trim() || null;
}
