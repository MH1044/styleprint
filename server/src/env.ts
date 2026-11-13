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

/**
 * Interface to listen on. The desktop app sets 127.0.0.1 so a user's corpus
 * and publik balance are never reachable from the local network; unset means
 * Node's default (all interfaces), which `npm run dev`'s Vite proxy relies on.
 */
export function listenHost(): string | undefined {
  return process.env.STYLEPRINT_HOST || undefined;
}
/** Set by the desktop shell so it can tell its own server apart from anything else on the port. */
export function instanceId(): string | null {
  return process.env.STYLEPRINT_INSTANCE || null;
}

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
