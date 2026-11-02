import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Every path and flag here is read live from process.env rather than frozen
// at import time, so tests can redirect VOICEBOX_HOME / toggle VOICEBOX_MOCK
// per-case without worrying about ESM import hoisting order.

export function voiceboxHome(): string {
  return process.env.VOICEBOX_HOME ?? path.join(os.homedir(), ".voicebox");
}
export function corpusDir(): string {
  return path.join(voiceboxHome(), "corpus");
}
export function documentsDir(): string {
  return path.join(voiceboxHome(), "documents");
}
export function dbPath(): string {
  return path.join(voiceboxHome(), "voicebox.sqlite");
}
export function credentialFilePath(): string {
  return path.join(voiceboxHome(), "credential.json");
}

export function ensureDirs(): void {
  for (const dir of [voiceboxHome(), corpusDir(), documentsDir()]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export const PORT = Number(process.env.PORT ?? 3001);

export function isMockMode(): boolean {
  return process.env.VOICEBOX_MOCK === "1";
}
export function publikApiBaseUrl(): string {
  return process.env.PUBLIK_API_BASE_URL ?? "https://publikhq.com/api/v1";
}
export function publikApiKey(): string | null {
  return process.env.PUBLIK_API_KEY ?? null;
}
