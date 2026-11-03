import type { Pass2Tail } from "@styleprint/shared";

export interface ParsedPass2 {
  text: string;
  tail: Pass2Tail;
}

const FALLBACK_TAIL: Pass2Tail = {
  confidence: 0.5,
  changed: [],
  unsure: [{ span: "", reason: "model response could not be parsed; treat as low confidence" }],
};

/**
 * Splits a pass-2 response into the rewritten paragraph and its trailing
 * {confidence, changed, unsure} JSON line. Falls back to a low-confidence
 * tail if the model didn't return parseable JSON on the last line.
 */
export function parsePass2Response(raw: string): ParsedPass2 {
  const trimmed = raw.trim();
  const lines = trimmed.split("\n");
  const lastLine = lines[lines.length - 1]?.trim() ?? "";

  if (!lastLine.startsWith("{")) {
    return { text: trimmed, tail: FALLBACK_TAIL };
  }

  const candidateJson = lastLine;
  const bodyText = lines.slice(0, -1).join("\n").trim();

  try {
    const parsed = JSON.parse(candidateJson) as Partial<Pass2Tail>;
    const tail: Pass2Tail = {
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : FALLBACK_TAIL.confidence,
      changed: Array.isArray(parsed.changed) ? parsed.changed : [],
      unsure: Array.isArray(parsed.unsure) ? parsed.unsure : [],
    };
    return { text: bodyText || trimmed, tail };
  } catch {
    return { text: trimmed, tail: FALLBACK_TAIL };
  }
}

