import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chatCompletion } from "../src/ai/client.js";

const ORIGINAL_ENV = { ...process.env };
const REAL_KEY = process.env.PUBLIK_API_KEY;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("publik wiring", () => {
  it.runIf(Boolean(REAL_KEY))("makes one real publik-fast call and prints its charge header", async () => {
    delete process.env.VOICEBOX_MOCK;
    const result = await chatCompletion({
      tier: "publik-fast",
      temperature: 0,
      prompt: "Reply with exactly the word: hello",
    });
    // eslint-disable-next-line no-console
    console.log("x-publik-charge-micros:", result.usage.chargeMicros);
    expect(result.usage.chargeMicros).not.toBeNull();
    expect(typeof result.text).toBe("string");
  });

  it.runIf(!REAL_KEY)(
    "falls back to the step-5 mock gate when PUBLIK_API_KEY is not set",
    async () => {
      process.env.VOICEBOX_MOCK = "1";
      const result = await chatCompletion({
        tier: "publik-fast",
        temperature: 0,
        prompt: "Paragraph to rewrite:\nThis is a short paragraph to rewrite in mock mode.",
        mock: { kind: "pass1", paragraph: "This is a short paragraph to rewrite in mock mode." },
      });
      expect(result.usage.model).toBe("publik-fast");
      expect(result.usage.chargeMicros).toBeGreaterThan(0);
      expect(result.text.length).toBeGreaterThan(0);
    }
  );
});
