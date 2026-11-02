import { splitIntoSentences, wordCount } from "./split.js";

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export interface AiLikenessResult {
  flagged: boolean;
  reason: string | null;
  burstiness: number;
  listDensity: number;
}

/**
 * Flags a sample that looks AI-written itself: very uniform sentence length
 * (low burstiness) combined with heavy list usage. The user can override.
 */
export function detectAiLikeSample(paragraphs: string[]): AiLikenessResult {
  const sentenceLengths = paragraphs
    .flatMap((p) => splitIntoSentences(p))
    .map((s) => wordCount(s))
    .filter((n) => n > 0);

  const burstiness = stdDev(sentenceLengths);

  const listLines = paragraphs.filter((p) => /^\s*([-*•]|\d+[.)])\s/.test(p)).length;
  const listDensity = paragraphs.length > 0 ? listLines / paragraphs.length : 0;

  const lowBurstiness = sentenceLengths.length >= 4 && burstiness < 2.5;
  const highListDensity = listDensity > 0.3;

  const flagged = lowBurstiness && highListDensity;
  let reason: string | null = null;
  if (flagged) {
    reason = `sentence-length variation is unusually low (std dev ${burstiness.toFixed(
      1
    )}) and ${(listDensity * 100).toFixed(0)}% of paragraphs are lists`;
  } else if (lowBurstiness) {
    reason = null;
  }

  return { flagged, reason, burstiness, listDensity };
}

function normaliseForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" "));
  const setB = new Set(b.split(" "));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Drops paragraphs that are near-duplicates (Jaccard >= 0.9) of an earlier one. */
export function dedupeParagraphs(paragraphs: string[]): string[] {
  const kept: string[] = [];
  const keptNormalised: string[] = [];
  for (const p of paragraphs) {
    const normalised = normaliseForCompare(p);
    const isDuplicate = keptNormalised.some((k) => jaccardSimilarity(k, normalised) >= 0.9);
    if (!isDuplicate) {
      kept.push(p);
      keptNormalised.push(normalised);
    }
  }
  return kept;
}

export const MIN_SAMPLE_WORDS = 80;
