import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeStyleProfile, styleVector, cosineSimilarity, voiceMatchScore } from "../src/fingerprint/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(__dirname, "../../fixtures/corpus");

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(CORPUS_DIR, name), "utf8");
}

describe("computeStyleProfile", () => {
  it("produces a full style.json with derived targets for each fixture", () => {
    for (const file of fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".md"))) {
      const profile = computeStyleProfile(loadFixture(file));

      expect(profile.wordCount).toBeGreaterThan(400);
      expect(profile.sentenceCount).toBeGreaterThan(10);
      expect(profile.sentenceLength.mean).toBeGreaterThan(0);
      expect(profile.sentenceLength.histogram.counts.length).toBeGreaterThan(0);
      expect(profile.paragraphLength.meanWords).toBeGreaterThan(0);
      expect(Object.keys(profile.functionWordFreq).length).toBeGreaterThan(10);
      expect(profile.openers.words.length).toBeGreaterThan(0);
      expect(profile.vocabulary.topContentWords.length).toBeGreaterThan(0);
      expect(profile.vocabulary.typeTokenRatio).toBeGreaterThan(0);
      expect(profile.vocabulary.typeTokenRatio).toBeLessThanOrEqual(1);

      // Derived targets, fed to the pass-2 prompt.
      expect(profile.targets.meanSentenceLen).toBeCloseTo(profile.sentenceLength.mean, 0);
      expect(profile.targets.avoidList.length).toBeGreaterThan(0);
      expect(Array.isArray(profile.targets.favoriteOpeners)).toBe(true);
    }
  });

  it("measures real burstiness in human prose, not near-zero variance", () => {
    const profile = computeStyleProfile(loadFixture("camping-trip.md"));
    expect(profile.sentenceLength.std).toBeGreaterThan(3);
  });

  it("keeps the corpus largely free of LLM vocabulary", () => {
    for (const file of fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".md"))) {
      const profile = computeStyleProfile(loadFixture(file));
      expect(profile.vocabulary.avoidListHits.length).toBe(0);
    }
  });
});

describe("cosine similarity", () => {
  it("is 1.0 for a text compared against itself", () => {
    const text = loadFixture("home-repairs.md");
    const profile = computeStyleProfile(text);
    const similarity = cosineSimilarity(styleVector(profile), styleVector(profile));
    expect(similarity).toBeCloseTo(1.0, 6);
  });

  it("gives a voice-match score of 100 for identical text", () => {
    const text = loadFixture("home-repairs.md");
    const profile = computeStyleProfile(text);
    expect(voiceMatchScore(profile, profile)).toBe(100);
  });

  it("scores two different human voices below a perfect match", () => {
    const a = computeStyleProfile(loadFixture("home-repairs.md"));
    const b = computeStyleProfile(loadFixture("camping-trip.md"));
    expect(voiceMatchScore(a, b)).toBeLessThan(100);
    expect(voiceMatchScore(a, b)).toBeGreaterThan(0);
  });
});
