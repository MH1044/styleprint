import type { ChatCompletionRequest, ChatCompletionResult, MockHint } from "@styleprint/shared";
import { splitIntoSentences, wordCount } from "../ingest/split.js";

const VERB_CONTRACTIONS: [RegExp, string][] = [
  [/\bdo not\b/gi, "don't"],
  [/\bdoes not\b/gi, "doesn't"],
  [/\bis not\b/gi, "isn't"],
  [/\bare not\b/gi, "aren't"],
  [/\bcannot\b/gi, "can't"],
  [/\bcan not\b/gi, "can't"],
  [/\bwill not\b/gi, "won't"],
  [/\bit is\b/gi, "it's"],
  [/\bthey are\b/gi, "they're"],
  [/\bwe are\b/gi, "we're"],
  [/\bI am\b/g, "I'm"],
  [/\bI have\b/g, "I've"],
  [/\bthis is\b/gi, "this's"],
  [/\bthat is\b/gi, "that's"],
  [/\bwho is\b/gi, "who's"],
  [/\bhave not\b/gi, "haven't"],
  [/\bhas not\b/gi, "hasn't"],
  [/\bwould not\b/gi, "wouldn't"],
  [/\bshould not\b/gi, "shouldn't"],
  [/\bwas not\b/gi, "wasn't"],
  [/\bwere not\b/gi, "weren't"],
];

// Stock AI throat-clearers and filler transitions: a real de-AI pass removes
// these; mock mode strips the same ones so sentence length can move toward
// the user's targets instead of staying frozen at the draft's own rhythm.
const FILLER_OPENERS: RegExp[] = [
  /^in today's fast-paced world,\s*/i,
  /^it is important to note that\s*/i,
  /^it is also worth noting that\s*/i,
  /^it is worth noting that\s*/i,
  /^it is crucial to acknowledge that\s*/i,
  /^moreover,\s*/i,
  /^furthermore,\s*/i,
  /^additionally,\s*/i,
  /^nevertheless,\s*/i,
  /^ultimately,\s*/i,
  /^in conclusion,\s*/i,
  /^in summary,\s*/i,
];

function stripFiller(sentence: string): string {
  let out = sentence;
  for (const pattern of FILLER_OPENERS) {
    if (pattern.test(out)) {
      out = out.replace(pattern, "");
      out = out.charAt(0).toUpperCase() + out.slice(1);
      break;
    }
  }
  return out;
}

const SPLIT_CONJUNCTIONS = [", and ", ", but ", ", while ", "; "];

/** Breaks an overly long sentence into two at the first coordinating conjunction. */
function splitLongSentence(sentence: string): string[] {
  if (wordCount(sentence) < 26) return [sentence];
  for (const conjunction of SPLIT_CONJUNCTIONS) {
    const idx = sentence.indexOf(conjunction);
    if (idx > 10) {
      const first = sentence.slice(0, idx).trim();
      let rest = sentence.slice(idx + conjunction.length).trim();
      rest = rest.charAt(0).toUpperCase() + rest.slice(1);
      const firstSentence = /[.!?]$/.test(first) ? first : `${first}.`;
      return [firstSentence, rest];
    }
  }
  return [sentence];
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const result = [...items];
  let s = seed || 1;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function applyContractions(text: string): string {
  let out = text;
  for (const [pattern, replacement] of VERB_CONTRACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function extractParagraph(hint: MockHint | undefined, prompt: string): string {
  if (hint?.paragraph) return hint.paragraph;
  const markers = ["Paragraph to rewrite:", "Paragraph:"];
  for (const marker of markers) {
    const idx = prompt.lastIndexOf(marker);
    if (idx >= 0) return prompt.slice(idx + marker.length).trim();
  }
  return prompt.trim();
}

/**
 * Deterministic rewrite for a paragraph: same input, same output, every
 * run. Strips stock AI filler openers, splits overly long sentences,
 * shuffles sentence order, and contracts verb phrases — a stand-in for a
 * real de-AI/voice pass that still measurably moves the style fingerprint,
 * not just the words. See DECISIONS.md.
 */
function mockRewrite(paragraph: string): string {
  const rawSentences = splitIntoSentences(paragraph);
  if (rawSentences.length === 0) return applyContractions(paragraph);

  const processed = rawSentences.flatMap((s) => splitLongSentence(stripFiller(s)));

  if (processed.length <= 1) return applyContractions(processed[0] ?? paragraph);

  const seed = paragraph.length + processed.length;
  const shuffled = seededShuffle(processed, seed);
  return applyContractions(shuffled.join(" "));
}

function mockStyleCard(): string {
  return [
    "Short, declarative sentences dominate, broken up by the occasional long,",
    "winding one that runs on through a comma splice or two. Paragraphs open",
    "with a concrete scene rather than a topic sentence, and close on an",
    "understated, slightly dry observation instead of a tidy summary.",
    "Contractions are constant. Dashes carry asides more often than commas do.",
    "Self-deprecating humor shows up every few paragraphs, never explained,",
    "never flagged as a joke. Lists are rare; when something could be three",
    "bullet points, it becomes one sentence with two commas instead.",
  ].join(" ");
}

export function mockChatCompletion(request: ChatCompletionRequest): ChatCompletionResult {
  const kind = request.mock?.kind ?? "generic";

  if (kind === "style-card") {
    return {
      text: mockStyleCard(),
      usage: mockUsage(request),
    };
  }

  const paragraph = extractParagraph(request.mock, request.prompt);
  const rewritten = mockRewrite(paragraph);

  if (kind === "pass1") {
    return { text: rewritten, usage: mockUsage(request) };
  }

  if (kind === "tag") {
    return {
      text: JSON.stringify({ factsOk: true, wordCountRatio: 1.0, avoidListHits: 0 }),
      usage: mockUsage(request),
    };
  }

  // pass2 and generic both carry the confidence/changed/unsure JSON tail.
  const tail = {
    confidence: 0.6,
    changed: ["varied sentence rhythm", "removed a hedge"],
    unsure: [{ span: rewritten.slice(0, Math.min(40, rewritten.length)), reason: "mock mode cannot judge tone" }],
  };
  return {
    text: `${rewritten}\n${JSON.stringify(tail)}`,
    usage: mockUsage(request),
  };
}

let mockBalanceMicros = 5_000_000;

function mockUsage(request: ChatCompletionRequest): ChatCompletionResult["usage"] {
  const chargeMicros = request.tier === "publik-fast" ? 1_000 : request.tier === "publik-smart" ? 18_000 : 10_000;
  mockBalanceMicros = Math.max(0, mockBalanceMicros - chargeMicros);
  return {
    model: request.tier,
    chargeMicros,
    balanceAfterMicros: mockBalanceMicros,
    weeklyUsageMicros: chargeMicros,
    weeklyBudgetMicros: 20_000_000,
    resetAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}
