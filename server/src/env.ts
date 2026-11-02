import os from "node:os";
import path from "node:path";
import fs from "node:fs";

function resolveHome(): string {
  const override = process.env.VOICEBOX_HOME;
  if (override) return override;
  return path.join(os.homedir(), ".voicebox");
}

export const VOICEBOX_HOME = resolveHome();
export const CORPUS_DIR = path.join(VOICEBOX_HOME, "corpus");
export const DOCUMENTS_DIR = path.join(VOICEBOX_HOME, "documents");
export const DB_PATH = path.join(VOICEBOX_HOME, "voicebox.sqlite");
export const CREDENTIAL_FILE = path.join(VOICEBOX_HOME, "credential.json");

export function ensureDirs(): void {
  for (const dir of [VOICEBOX_HOME, CORPUS_DIR, DOCUMENTS_DIR]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export const PORT = Number(process.env.PORT ?? 3001);
export const MOCK_MODE = process.env.VOICEBOX_MOCK === "1";
export const PUBLIK_API_BASE_URL = process.env.PUBLIK_API_BASE_URL ?? "https://publikhq.com/api/v1";
export const PUBLIK_API_KEY = process.env.PUBLIK_API_KEY ?? null;
