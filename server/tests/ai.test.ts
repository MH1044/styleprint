import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chatCompletion } from "../src/ai/client.js";
import { resolveCredentials, NoCredentialsError, writeCredentialFile } from "../src/ai/index.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.VOICEBOX_MOCK = "1";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("chatCompletion in mock mode", () => {
  it("returns a rewrite with a parseable JSON tail for pass2", async () => {
    const result = await chatCompletion({
      tier: "publik-balanced",
      temperature: 0.5,
      prompt: "Paragraph:\nThis is the paragraph to rewrite. It has two sentences.",
      mock: { kind: "pass2", paragraph: "This is the paragraph to rewrite. It has two sentences." },
    });

    const lines = result.text.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    const tail = JSON.parse(lastLine) as { confidence: number; changed: string[]; unsure: { span: string; reason: string }[] };

    expect(tail.confidence).toBeGreaterThanOrEqual(0);
    expect(tail.confidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(tail.changed)).toBe(true);
    expect(Array.isArray(tail.unsure)).toBe(true);
    expect(tail.unsure.length).toBeGreaterThanOrEqual(1);
  });

  it("returns only the rewritten paragraph for pass1, no JSON tail", async () => {
    const result = await chatCompletion({
      tier: "publik-balanced",
      temperature: 0.7,
      prompt: "Paragraph to rewrite:\nShort sentence. A longer second sentence follows here.",
      mock: { kind: "pass1", paragraph: "Short sentence. A longer second sentence follows here." },
    });

    expect(() => JSON.parse(result.text)).toThrow();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("is deterministic for the same paragraph", async () => {
    const paragraph = "One. Two sentences here. Three comes after that one.";
    const a = await chatCompletion({ tier: "publik-fast", temperature: 0, prompt: paragraph, mock: { kind: "pass1", paragraph } });
    const b = await chatCompletion({ tier: "publik-fast", temperature: 0, prompt: paragraph, mock: { kind: "pass1", paragraph } });
    expect(a.text).toBe(b.text);
  });

  it("captures usage headers with the tier as the model name", async () => {
    const result = await chatCompletion({
      tier: "publik-fast",
      temperature: 0,
      prompt: "tag this",
      mock: { kind: "tag" },
    });
    expect(result.usage.model).toBe("publik-fast");
    expect(result.usage.chargeMicros).toBeGreaterThan(0);
    expect(result.usage.balanceAfterMicros).not.toBeNull();
  });
});

describe("resolveCredentials", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "voicebox-test-"));
    process.env.VOICEBOX_HOME = tmpHome;
    delete process.env.PUBLIK_API_KEY;
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("throws NoCredentialsError when nothing is configured", () => {
    expect(() => resolveCredentials()).toThrow(NoCredentialsError);
  });

  it("uses PUBLIK_API_KEY from the environment when no own key is set", () => {
    process.env.PUBLIK_API_KEY = "pk_live_env_test";
    const creds = resolveCredentials();
    expect(creds.source).toBe("env");
    expect(creds.apiKey).toBe("pk_live_env_test");
  });

  it("prefers the user's own key over the env key", () => {
    process.env.PUBLIK_API_KEY = "pk_live_env_test";
    writeCredentialFile({ userKey: "sk-own-key", userBaseUrl: "https://my-own-server.example/v1" });
    const creds = resolveCredentials();
    expect(creds.source).toBe("own-key");
    expect(creds.apiKey).toBe("sk-own-key");
    expect(creds.baseURL).toBe("https://my-own-server.example/v1");
  });

  it("falls back to the per-install credential file when no env key is set", () => {
    writeCredentialFile({ installKey: "pk_install_abc" });
    const creds = resolveCredentials();
    expect(creds.source).toBe("install-file");
    expect(creds.apiKey).toBe("pk_install_abc");
  });
});
