import fs from "node:fs";
import { credentialFilePath, ensureDirs } from "../env.js";

export interface CredentialFile {
  /** Per-install key minted via POST /installs from the public app token. */
  installKey?: string;
  /** User's own OpenAI-compatible key, always available as an override. */
  userKey?: string;
  userBaseUrl?: string;
}

export function readCredentialFile(): CredentialFile | null {
  try {
    const raw = fs.readFileSync(credentialFilePath(), "utf8");
    return JSON.parse(raw) as CredentialFile;
  } catch {
    return null;
  }
}

export function writeCredentialFile(patch: Partial<CredentialFile>): CredentialFile {
  ensureDirs();
  const current = readCredentialFile() ?? {};
  const next = { ...current, ...patch };
  fs.writeFileSync(credentialFilePath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export function clearUserKey(): void {
  const current = readCredentialFile() ?? {};
  delete current.userKey;
  delete current.userBaseUrl;
  ensureDirs();
  fs.writeFileSync(credentialFilePath(), JSON.stringify(current, null, 2), { mode: 0o600 });
}
