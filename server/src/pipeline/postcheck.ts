import { wordCount } from "../ingest/split.js";
import { extractKeepSpans } from "./protect.js";
import { chatCompletion } from "../ai/client.js";
import { renderPrompt } from "./prompts.js";
import type { AiUsageHeaders, ModelTier } from "@voicebox/shared";

export interface LocalCheckResult {
  passed: boolean;
  failures: string[];
}

/**
 * Local, no-model checks: every fact survives, length stayed within ±30%,
 * and no ⟦keep⟧ span was altered or dropped. Avoid-list words are flagged
 * too, since both rewrite prompts are told never to use them.
 */
export function runLocalChecks(
  originalText: string,
  facts: string[],
  rewrittenRaw: string,
  avoidList: string[]
): LocalCheckResult {
  const failures: string[] = [];

  for (const fact of facts) {
    if (!rewrittenRaw.includes(fact)) {
      failures.push(`the fact "${fact}" did not survive the rewrite`);
    }
  }

  const rewrittenKeepSpans = extractKeepSpans(rewrittenRaw);
  for (const fact of facts) {
    if (!rewrittenKeepSpans.includes(fact)) {
      failures.push(`the protected span "${fact}" was altered or its ⟦keep⟧ markers were dropped`);
    }
  }

  const originalWords = wordCount(originalText);
  const rewrittenWords = wordCount(rewrittenRaw);
  if (originalWords > 0) {
    const ratio = rewrittenWords / originalWords;
    if (ratio < 0.7 || ratio > 1.3) {
      failures.push(
        `length drifted too far: ${rewrittenWords} words vs ${originalWords} original (${Math.round(ratio * 100)}%)`
      );
    }
  }

  const lowerRewritten = rewrittenRaw.toLowerCase();
  for (const word of avoidList) {
    if (new RegExp(`\\b${word}\\b`, "i").test(lowerRewritten)) {
      failures.push(`avoid-list word "${word}" appears in the rewrite`);
    }
  }

  return { passed: failures.length === 0, failures: [...new Set(failures)] };
}

export interface FastTagResult {
  factsOk: boolean;
  reason: string | null;
  usage: AiUsageHeaders;
}

/** One publik-fast call as a semantic cross-check on top of the local checks. */
export async function runFastTagCheck(rewrittenClean: string, facts: string[]): Promise<FastTagResult> {
  const prompt = `Facts that must all still be present, exactly: ${JSON.stringify(
    facts
  )}\n\nText:\n${rewrittenClean}\n\nRespond with JSON only: {"factsOk": true|false, "reason": "<short reason if false>"}`;

  const result = await chatCompletion({
    tier: "publik-fast" satisfies ModelTier,
    temperature: 0,
    prompt,
    mock: { kind: "tag" },
  });

  try {
    const parsed = JSON.parse(result.text) as { factsOk?: boolean; reason?: string };
    return { factsOk: parsed.factsOk !== false, reason: parsed.reason ?? null, usage: result.usage };
  } catch {
    return { factsOk: true, reason: null, usage: result.usage };
  }
}

export function buildRetrySuffix(failure: string): string {
  return renderPrompt("postcheck-retry", { failure });
}
