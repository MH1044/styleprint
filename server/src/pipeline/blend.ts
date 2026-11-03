import { splitIntoSentences } from "../ingest/split.js";

/**
 * Local, no-model blend: picks sentences from either side of a slider
 * instead of asking a model to merge two versions. ratio=0 is all original,
 * ratio=1 is all rewritten.
 */
export function blendParagraphs(original: string, rewritten: string, ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const originalSentences = splitIntoSentences(original);
  const rewrittenSentences = splitIntoSentences(rewritten);
  const sentenceCount = Math.max(originalSentences.length, rewrittenSentences.length, 1);
  const rewrittenCount = Math.round(sentenceCount * clamped);

  const result: string[] = [];
  for (let i = 0; i < sentenceCount; i++) {
    const useRewritten = i < rewrittenCount;
    const pool = useRewritten ? rewrittenSentences : originalSentences;
    const sentence = pool[i] ?? pool[pool.length - 1];
    if (sentence) result.push(sentence);
  }
  return result.join(" ");
}
