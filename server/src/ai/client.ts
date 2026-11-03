import OpenAI from "openai";
import type { AiUsageHeaders, ChatCompletionRequest, ChatCompletionResult, EmbeddingResult } from "@voicebox/shared";
import { PublikPaymentError } from "@voicebox/shared";
import { isMockMode, publikApiBaseUrl, publikApiKey } from "../env.js";
import { readCredentialFile } from "./credentials.js";
import { mockChatCompletion } from "./mock.js";

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

interface InstallResponseBody {
  key?: string;
  api_key?: string;
}

/**
 * POST /installs: mints a per-install pk_ key from the public app token.
 * Documented as a manual step in README since the real mint needs a human
 * to approve in a browser mid-flow; this function is what that step calls.
 */
export async function provisionInstallKey(appToken: string, baseURL?: string): Promise<string> {
  const url = `${baseURL ?? publikApiBaseUrl()}/installs`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${appToken}` },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`install provisioning failed: ${response.status}`);
  }
  const body = (await response.json()) as InstallResponseBody;
  const key = body.key ?? body.api_key;
  if (!key) throw new Error("install response did not include a key");
  return key;
}
