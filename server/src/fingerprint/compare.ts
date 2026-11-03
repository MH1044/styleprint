import type { StyleProfile } from "@styleprint/shared";
import { FUNCTION_WORDS } from "./functionWords.js";

/**
 * Flattens a style profile into a fixed-order numeric feature vector so two
 * profiles (or a profile and itself) can be compared with cosine similarity.
 * Order must stay stable across calls — it is not persisted, only compared.
 */
export function styleVector(profile: StyleProfile): number[] {
  const functionWordVector = FUNCTION_WORDS.map((w) => profile.functionWordFreq[w] ?? 0);
  return [
    profile.sentenceLength.mean,
    profile.sentenceLength.std,
    profile.paragraphLength.meanSentences,
    profile.paragraphLength.meanWords,
    profile.punctuation.emDashPer100Words,
    profile.punctuation.semicolonPer100Words,
    profile.punctuation.parenPer100Words,
    profile.punctuation.exclaimPer100Words,
    profile.punctuation.oxfordComma ? 1 : 0,
    profile.contractionRate,
    profile.vocabulary.typeTokenRatio * 100,
    profile.hedging.perHundredWords,
    profile.hedging.intensifierPerHundredWords,
    ...functionWordVector,
  ];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("vectors must be the same length");
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return normA === normB ? 1 : 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function rhythmVector(p: StyleProfile): number[] {
  return [p.sentenceLength.mean, p.sentenceLength.std, p.paragraphLength.meanSentences, p.paragraphLength.meanWords];
}

function punctuationVector(p: StyleProfile): number[] {
  return [
    p.punctuation.emDashPer100Words,
    p.punctuation.semicolonPer100Words,
    p.punctuation.parenPer100Words,
    p.punctuation.exclaimPer100Words,
    p.punctuation.oxfordComma ? 1 : 0,
    p.contractionRate,
  ];
}

function vocabVector(p: StyleProfile): number[] {
  return [p.vocabulary.typeTokenRatio * 100, p.hedging.perHundredWords, p.hedging.intensifierPerHundredWords];
}

function functionWordVector(p: StyleProfile): number[] {
  return FUNCTION_WORDS.map((w) => p.functionWordFreq[w] ?? 0);
}

/**
 * Voice-match score: a weighted average of cosine similarities across four
 * feature groups (sentence/paragraph rhythm, punctuation and contractions,
 * vocabulary/hedging, function-word profile), rather than one flat cosine
 * over the concatenated vector. A flat vector lets the 150-wide function-word
 * block drown out the handful of dimensions — sentence rhythm, contraction
 * rate, dash/semicolon rate — that the rewrite passes are actually designed
 * to move, so a real de-AI/voice pass could leave the score unchanged. See
 * DECISIONS.md.
 */
export function voiceMatchScore(a: StyleProfile, b: StyleProfile): number {
  const groups: [number[], number[], number][] = [
    [rhythmVector(a), rhythmVector(b), 0.4],
    [punctuationVector(a), punctuationVector(b), 0.25],
    [vocabVector(a), vocabVector(b), 0.15],
    [functionWordVector(a), functionWordVector(b), 0.2],
  ];

  let weightedTotal = 0;
  let weightSum = 0;
  for (const [va, vb, weight] of groups) {
    weightedTotal += cosineSimilarity(va, vb) * weight;
    weightSum += weight;
  }

  const similarity = weightSum > 0 ? weightedTotal / weightSum : 0;
  return Math.round(Math.max(0, Math.min(1, similarity)) * 100);
}
