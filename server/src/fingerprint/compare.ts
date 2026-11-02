import type { StyleProfile } from "@voicebox/shared";
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

/** 0-100 voice-match score: cosine similarity between two style profiles. */
export function voiceMatchScore(a: StyleProfile, b: StyleProfile): number {
  const similarity = cosineSimilarity(styleVector(a), styleVector(b));
  return Math.round(Math.max(0, Math.min(1, similarity)) * 100);
}
