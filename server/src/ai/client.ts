import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AiUsageHeaders, ChatCompletionRequest, ChatCompletionResult, EmbeddingResult } from "@styleprint/shared";
import { PublikPaymentError } from "@styleprint/shared";
import { isMockMode, publikApiBaseUrl, publikApiKey, publikAppTokenEnv } from "../env.js";
import { readCredentialFile, writeCredentialFile, type CredentialFile } from "./credentials.js";
import { mockChatCompletion } from "./mock.js";

/** Identifies this app to publik. Bump APP_VERSION when cutting a tagged release. */
export const APP_SLUG = "styleprint";
export const APP_VERSION = "0.1.0";

export type CredentialSource = "own-key" | "env" | "install-file";

export class NoCredentialsError extends Error {
  constructor() {
    super("No publik key configured. Add your own key, or install a per-install key via first run.");
    this.name = "NoCredentialsError";
  }
}

interface ResolvedCredentials {
  source: CredentialSource;
  apiKey: string;
  baseURL: string;
}

/**
 * Client order: user's own key + base URL from settings, then PUBLIK_API_KEY
 * env, then the per-install credential file. Mock mode bypasses all of this
 * and is checked by the caller before this function runs.
 */
export function resolveCredentials(): ResolvedCredentials {
  const stored = readCredentialFile();
  const baseURL = publikApiBaseUrl();
  const envKey = publikApiKey();

  if (stored?.userKey) {
    return { source: "own-key", apiKey: stored.userKey, baseURL: stored.userBaseUrl ?? baseURL };
  }
  if (envKey) {
    return { source: "env", apiKey: envKey, baseURL };
  }
  if (stored?.installKey) {
    return { source: "install-file", apiKey: stored.installKey, baseURL };
  }
  throw new NoCredentialsError();
}

function extractUsageHeaders(headers: Headers): AiUsageHeaders {
  const num = (name: string): number | null => {
    const value = headers.get(name);
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    model: headers.get("x-publik-model"),
    chargeMicros: num("x-publik-charge-micros"),
    balanceAfterMicros: num("x-publik-balance-after-micros"),
    weeklyUsageMicros: num("x-publik-weekly-usage-micros"),
    weeklyBudgetMicros: num("x-publik-weekly-budget-micros"),
    resetAt: headers.get("x-publik-reset-at"),
  };
}

interface ErrorBody {
  error?: { message?: string; top_up_url?: string };
  message?: string;
  top_up_url?: string;
}

function toPublikError(err: unknown): unknown {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: number }).status;
    if (status === 402) {
      const body = (err as { error?: ErrorBody }).error ?? {};
      const message = body.error?.message ?? body.message ?? "Payment required.";
      const topUpUrl = body.error?.top_up_url ?? body.top_up_url ?? null;
      return new PublikPaymentError(message, topUpUrl ?? null);
    }
  }
  return err;
}

function buildClient(): { client: OpenAI; source: CredentialSource } {
  const creds = resolveCredentials();
  return { client: new OpenAI({ apiKey: creds.apiKey, baseURL: creds.baseURL }), source: creds.source };
}

export async function chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
  if (isMockMode()) return mockChatCompletion(request);

  const { client } = buildClient();
  try {
    const { data, response } = await client.chat.completions
      .create({
        model: request.tier,
        temperature: request.temperature,
        messages: [
          ...(request.system ? [{ role: "system" as const, content: request.system }] : []),
          { role: "user" as const, content: request.prompt },
        ],
      })
      .withResponse();

    const text = data.choices[0]?.message?.content ?? "";
    return { text, usage: extractUsageHeaders(response.headers) };
  } catch (err) {
    throw toPublikError(err);
  }
}

/** Primary embeddings path. Throws in mock mode so the embeddings module falls back to local TF-IDF. */
export async function createEmbeddings(texts: string[]): Promise<EmbeddingResult> {
  if (isMockMode()) {
    throw new Error("embeddings unavailable in mock mode; fall back to TF-IDF");
  }

  const { client } = buildClient();
  try {
    const { data, response } = await client.embeddings
      .create({ model: "publik-embed", input: texts })
      .withResponse();
    const vectors = data.data.map((d) => d.embedding as number[]);
    return { vectors, usage: extractUsageHeaders(response.headers), source: "publik" };
  } catch (err) {
    throw toPublikError(err);
  }
}

export interface WalletStatus {
  balanceMicros: number | null;
  weeklyUsageMicros: number | null;
  weeklyBudgetMicros: number | null;
  resetAt: string | null;
  source: "mock" | "live";
}

interface WalletResponseBody {
  balance_micros?: number;
  weekly_usage_micros?: number;
  weekly_budget_micros?: number;
  reset_at?: string;
}

/** GET /wallet: balance, weekly budget, reset time, shown in the app footer. */
export async function getWallet(): Promise<WalletStatus> {
  if (isMockMode()) {
    return {
      balanceMicros: 5_000_000,
      weeklyUsageMicros: 0,
      weeklyBudgetMicros: 20_000_000,
      resetAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      source: "mock",
    };
  }

  const creds = resolveCredentials();
  const response = await fetch(`${creds.baseURL}/wallet`, {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
  });
  if (!response.ok) {
    if (response.status === 402) {
      const body = (await response.json().catch(() => ({}))) as ErrorBody;
      throw new PublikPaymentError(body.error?.message ?? body.message ?? "Payment required.", body.error?.top_up_url ?? body.top_up_url ?? null);
    }
    throw new Error(`wallet request failed: ${response.status}`);
  }
  const body = (await response.json()) as WalletResponseBody;
  return {
    balanceMicros: body.balance_micros ?? null,
    weeklyUsageMicros: body.weekly_usage_micros ?? null,
    weeklyBudgetMicros: body.weekly_budget_micros ?? null,
    resetAt: body.reset_at ?? null,
    source: "live",
  };
}

/**
 * Finds publik-app-token.txt next to this module or in a parent directory
 * (the repo root, or — once bundled for the desktop build — the resources/
 * server/ folder scripts/bundle-desktop.mjs copies it into). PUBLIK_APP_TOKEN
 * in the environment overrides it.
 */
function readAppToken(): string {
  const envToken = publikAppTokenEnv();
  if (envToken) return envToken;
  const startDir = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = startDir; ; dir = path.dirname(dir)) {
    const file = path.join(dir, "publik-app-token.txt");
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
    const parent = path.dirname(dir);
    if (parent === dir) return "";
  }
}

function currentOsName(): "macos" | "windows" | "linux" {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

interface InstallResponseBody {
  key?: string;
  base_url?: string;
  install_id?: string;
  claim_url?: string | null;
  claim_state?: CredentialFile["installClaimState"];
  balance_micros?: number | null;
  wallet?: { add_credit_url?: string | null };
  disclosure?: { cost?: string | null };
  error?: { message?: string; type?: string };
}

/**
 * POST /installs: mints (or re-fetches) a per-install pk_ key from the
 * public app token. Called after the user accepts the publik disclosure, or
 * by selfTest() as the builder's own consent to prove the wiring works.
 */
export async function provision(): Promise<CredentialFile> {
  const token = readAppToken();
  if (!token.startsWith("pat_")) {
    throw new Error("This build has no publik API app token. Use your own key for now.");
  }

  const baseURL = publikApiBaseUrl();
  const prior = readCredentialFile();
  let installId = prior?.installId ?? randomUUID();

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${baseURL}/installs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_token: token,
        app_slug: APP_SLUG,
        app_version: APP_VERSION,
        os: currentOsName(),
        arch: process.arch,
        device_name: os.hostname().slice(0, 120),
        install_id: installId,
        disclosure_version: 1,
        dialects: ["chat_completions"],
      }),
    });
    const body = (await response.json().catch(() => ({}))) as InstallResponseBody;
    const key = body.key ?? (response.status === 200 ? prior?.installKey ?? null : null);

    if ((response.status === 201 || response.status === 200) && key) {
      const next = writeCredentialFile({
        installKey: key,
        installId: body.install_id ?? installId,
        installClaimUrl: body.claim_url ?? null,
        installClaimState: body.claim_state ?? "anonymous",
        installAddCreditUrl: body.wallet?.add_credit_url ?? null,
        installCostSentence: body.disclosure?.cost ?? null,
        installBalanceMicros: body.balance_micros ?? null,
      });
      return next;
    }
    // A replay with no key on disk, or an install its owner revoked: retry once with a fresh install_id.
    if (response.status === 200 || body.error?.type === "install_revoked") {
      installId = randomUUID();
      continue;
    }
    throw new Error(body.error?.message ?? `publik API could not set up this computer (${response.status}). Use your own key for now.`);
  }
  throw new Error("publik API could not set up this computer. Use your own key for now.");
}

/**
 * Builder check: start the built app with PUBLIK_SELF_TEST=1 and read this
 * line. It provisions for real — the builder running it is the consent.
 * See https://publikhq.com/skills/setup.md step 6.
 */
export async function selfTest(): Promise<string> {
  try {
    const cred = await provision();
    return `publik self-test: ok ${APP_SLUG} ${APP_VERSION} (install ${(cred.installId ?? "").slice(0, 8)})`;
  } catch (e) {
    return `publik self-test: failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}
