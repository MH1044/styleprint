import type { Histogram, StyleProfile, StyleTargets } from "@styleprint/shared";
import { splitIntoParagraphs, splitIntoSentences, wordCount } from "../ingest/split.js";
import { FUNCTION_WORD_SET } from "./functionWords.js";
import { LLM_VOCAB } from "./llmVocab.js";

const HEDGE_WORDS = [
  "perhaps",
  "maybe",
  "possibly",
  "probably",
  "i think",
  "i believe",
  "i guess",
  "sort of",
  "kind of",
  "somewhat",
  "seems like",
  "i suppose",
];

const INTENSIFIER_WORDS = ["very", "really", "extremely", "totally", "absolutely", "incredibly", "so"];

const INFORMAL_SPELLINGS = ["gonna", "wanna", "kinda", "sorta", "alot", "thru", "cuz", "cause", "dunno"];

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function tokenizeWords(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g);
  return matches ?? [];
}

function buildHistogram(values: number[], bucketSize: number): Histogram {
  if (values.length === 0) return { bucketSize, counts: [] };
  const maxBucket = Math.floor(Math.max(...values) / bucketSize);
  const counts = new Array(maxBucket + 1).fill(0) as number[];
  for (const v of values) {
    counts[Math.floor(v / bucketSize)]++;
  }
  return { bucketSize, counts };
}

function topN<T extends string>(freq: Map<T, number>, n: number): [T, number][] {
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

function countOccurrences(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function detectOxfordComma(text: string): boolean {
  const oxford = countOccurrences(text, /\b\w+(?:,\s+\w+){1,},\s+and\s+\w+/gi);
  const nonOxford = countOccurrences(text, /\b\w+(?:,\s+\w+){1,}\s+and\s+\w+/gi) - oxford;
  if (oxford === 0 && nonOxford === 0) return true;
  return oxford >= nonOxford;
}

/**
 * Computes the Layer-1 style fingerprint, purely from local statistics.
 * No model call. Deterministic: same text in, same profile out.
 */
export function computeStyleProfile(text: string): StyleProfile {
  const paragraphs = splitIntoParagraphs(text);
  const sentencesByParagraph = paragraphs.map((p) => splitIntoSentences(p));
  const allSentences = sentencesByParagraph.flat();
  const sentenceLengths = allSentences.map((s) => wordCount(s));
  const totalWords = wordCount(text);
  const lowerText = text.toLowerCase();
  const tokens = tokenizeWords(text);

  const sentenceLenMean = mean(sentenceLengths);
  const sentenceLenStd = stdDev(sentenceLengths);

  const paragraphSentenceCounts = sentencesByParagraph.map((s) => s.length);
  const paragraphWordCounts = paragraphs.map((p) => wordCount(p));

  const functionFreq: Record<string, number> = {};
  for (const word of FUNCTION_WORD_SET) {
    const count = tokens.filter((t) => t === word).length;
    if (count > 0) functionFreq[word] = Number(((count / Math.max(totalWords, 1)) * 1000).toFixed(3));
  }

  const per100 = (count: number) => Number(((count / Math.max(totalWords, 1)) * 100).toFixed(3));

  const emDashCount = countOccurrences(text, /—|--/g);
  const semicolonCount = countOccurrences(text, /;/g);
  const parenCount = countOccurrences(text, /\(/g);
  const exclaimCount = countOccurrences(text, /!/g);

  const openerWordFreq = new Map<string, number>();
  const openerBigramFreq = new Map<string, number>();
  for (const sentence of allSentences) {
    const words = tokenizeWords(sentence);
    if (words.length === 0) continue;
    openerWordFreq.set(words[0], (openerWordFreq.get(words[0]) ?? 0) + 1);
    if (words.length > 1) {
      const bigram = `${words[0]} ${words[1]}`;
      openerBigramFreq.set(bigram, (openerBigramFreq.get(bigram) ?? 0) + 1);
    }
  }

  const contractionCount = countOccurrences(text, /\b\w+['’](?:t|re|ve|ll|d|s|m)\b/gi);
  const contractionRate = per100(contractionCount);

  const typeTokenRatio = tokens.length > 0 ? new Set(tokens).size / tokens.length : 0;
  const contentFreq = new Map<string, number>();
  for (const t of tokens) {
    if (t.length > 2 && !FUNCTION_WORD_SET.has(t)) {
      contentFreq.set(t, (contentFreq.get(t) ?? 0) + 1);
    }
  }
  const topContentWords = topN(contentFreq, 200);

  const avoidListHits: [string, number][] = LLM_VOCAB.map((word) => {
    const count = countOccurrences(lowerText, new RegExp(`\\b${word}\\b`, "g"));
    return [word, count] as [string, number];
  }).filter(([, count]) => count > 0);

  const hedgeCount = HEDGE_WORDS.reduce((acc, phrase) => acc + countOccurrences(lowerText, new RegExp(`\\b${phrase}\\b`, "g")), 0);
  const intensifierCount = INTENSIFIER_WORDS.reduce(
    (acc, word) => acc + countOccurrences(lowerText, new RegExp(`\\b${word}\\b`, "g")),
    0
  );

  const repeatedSpellings = INFORMAL_SPELLINGS.filter(
    (word) => countOccurrences(lowerText, new RegExp(`\\b${word}\\b`, "g")) >= 2
  );
  const lowercaseI = /(^|\s)i(\s|['’]\w)/.test(text) && !/(^|\s)I(\s|['’]\w)/.test(" " + text);
  const doubleSpaces = /[^\n]  [^\n]/.test(text);

  const openers = {
    words: topN(openerWordFreq, 30),
    bigrams: topN(openerBigramFreq, 30),
  };

  const targets: StyleTargets = {
    meanSentenceLen: Number(sentenceLenMean.toFixed(1)),
    stdSentenceLen: Number(sentenceLenStd.toFixed(1)),
    shortSentencePerParagraph: paragraphSentenceCounts.some((_, i) =>
      sentencesByParagraph[i]?.some((s) => wordCount(s) < 6)
    ),
    contractionRate,
    emDashRate: per100(emDashCount),
    semicolonRate: per100(semicolonCount),
    avoidList: LLM_VOCAB,
    favoriteOpeners: openers.words.slice(0, 10).map(([w]) => w),
  };

  return {
    wordCount: totalWords,
    sentenceCount: allSentences.length,
    paragraphCount: paragraphs.length,
    sentenceLength: {
      mean: Number(sentenceLenMean.toFixed(2)),
      std: Number(sentenceLenStd.toFixed(2)),
      histogram: buildHistogram(sentenceLengths, 5),
    },
    paragraphLength: {
      meanSentences: Number(mean(paragraphSentenceCounts).toFixed(2)),
      meanWords: Number(mean(paragraphWordCounts).toFixed(2)),
    },
    functionWordFreq: functionFreq,
    punctuation: {
      emDashPer100Words: per100(emDashCount),
      semicolonPer100Words: per100(semicolonCount),
      parenPer100Words: per100(parenCount),
      exclaimPer100Words: per100(exclaimCount),
      oxfordComma: detectOxfordComma(text),
    },
    openers,
    contractionRate,
    vocabulary: {
      typeTokenRatio: Number(typeTokenRatio.toFixed(3)),
      topContentWords,
      avoidListHits,
    },
    hedging: {
      perHundredWords: per100(hedgeCount),
      intensifierPerHundredWords: per100(intensifierCount),
    },
    quirks: {
      repeatedSpellings,
      lowercaseI,
      doubleSpaces,
    },
    targets,
  };
}
