// Shared types between server and web. Mirrors the SQLite data model in SPEC.md.

export type Tag = "email" | "essay" | "blog" | "report" | "other";

export interface Profile {
  id: string;
  name: string;
  createdAt: string;
  styleJson: StyleProfile | null;
  styleCard: string | null;
  loraPath: string | null;
}

export interface Sample {
  id: string;
  profileId: string;
  title: string;
  sourcePath: string | null;
  tag: Tag;
  text: string;
  wordCount: number;
  flaggedAi: boolean;
}

export type ChunkKind = "sentence" | "paragraph";

export interface Chunk {
  id: string;
  sampleId: string;
  kind: ChunkKind;
  text: string;
  embedding: number[];
}

export interface VoiceDocument {
  id: string;
  profileId: string;
  title: string;
  draftText: string;
  editorJson: unknown | null;
  voiceMatch: number | null;
  createdAt: string;
}

export type ParagraphStatus = "pending" | "done" | "needs_review";

export interface ParagraphRecord {
  id: string;
  documentId: string;
  idx: number;
  original: string;
  pass1: string | null;
  pass2: string | null;
  final: string | null;
  confidence: number | null;
  unsureJson: UnsureSpan[] | null;
  status: ParagraphStatus;
}

export type DecisionAction = "keep" | "revert" | "retry" | "edit" | "blend";

export interface Decision {
  id: string;
  documentId: string;
  paragraphId: string;
  action: DecisionAction;
  steer: string | null;
  createdAt: string;
}

export interface VersionRecord {
  id: string;
  documentId: string;
  label: string;
  editorJson: unknown;
  createdAt: string;
}

export type ModelTier = "publik-fast" | "publik-balanced" | "publik-smart";

export interface SpendRecord {
  id: string;
  documentId: string | null;
  call: string;
  tier: ModelTier;
  chargeMicros: number;
  balanceAfterMicros: number | null;
  createdAt: string;
}

// ---- Style fingerprint (Layer 1) ----

export interface Histogram {
  bucketSize: number;
  counts: number[];
}

export interface StyleProfile {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  sentenceLength: { mean: number; std: number; histogram: Histogram };
  paragraphLength: { meanSentences: number; meanWords: number };
  functionWordFreq: Record<string, number>;
  punctuation: {
    emDashPer100Words: number;
    semicolonPer100Words: number;
    parenPer100Words: number;
    exclaimPer100Words: number;
    oxfordComma: boolean;
  };
  openers: { words: [string, number][]; bigrams: [string, number][] };
  contractionRate: number;
  vocabulary: {
    typeTokenRatio: number;
    topContentWords: [string, number][];
    avoidListHits: [string, number][];
  };
  hedging: { perHundredWords: number; intensifierPerHundredWords: number };
  quirks: { repeatedSpellings: string[]; lowercaseI: boolean; doubleSpaces: boolean };
  targets: StyleTargets;
}

export interface StyleTargets {
  meanSentenceLen: number;
  stdSentenceLen: number;
  shortSentencePerParagraph: boolean;
  contractionRate: number;
  emDashRate: number;
  semicolonRate: number;
  avoidList: string[];
  favoriteOpeners: string[];
}

// ---- AI client / pipeline ----

export interface AiUsageHeaders {
  model: string | null;
  chargeMicros: number | null;
  balanceAfterMicros: number | null;
  weeklyUsageMicros: number | null;
  weeklyBudgetMicros: number | null;
  resetAt: string | null;
}

export interface ChatCompletionRequest {
  tier: ModelTier;
  system?: string;
  prompt: string;
  temperature: number;
}

export interface ChatCompletionResult {
  text: string;
  usage: AiUsageHeaders;
}

export interface EmbeddingResult {
  vectors: number[][];
  usage: AiUsageHeaders;
  source: "publik" | "tfidf";
}

export class PublikPaymentError extends Error {
  topUpUrl: string | null;
  constructor(message: string, topUpUrl: string | null) {
    super(message);
    this.name = "PublikPaymentError";
    this.topUpUrl = topUpUrl;
  }
}

export interface UnsureSpan {
  span: string;
  reason: string;
}

export interface Pass2Tail {
  confidence: number;
  changed: string[];
  unsure: UnsureSpan[];
}

export interface PipelineParagraphResult {
  idx: number;
  original: string;
  pass1: string;
  pass2: string;
  final: string;
  confidence: number;
  unsure: UnsureSpan[];
  status: ParagraphStatus;
  checksFailed: string[];
}

export interface PipelineRunResult {
  documentId: string;
  paragraphs: PipelineParagraphResult[];
  voiceMatchBefore: number;
  voiceMatchAfter: number;
  totalChargeMicros: number;
}
