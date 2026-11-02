const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";

interface Span {
  start: number;
  end: number;
  text: string;
}

const PATTERNS: RegExp[] = [
  // Quarter + year: "Q3 2026"
  /\bQ[1-4]\s+\d{4}\b/g,
  // Month + year or month + day + year
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:,)?\\s+\\d{4}\\b`, "g"),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{4}\\b`, "g"),
  // Money: $3.2 million, $50, $1,200
  /\$\d[\d,]*(?:\.\d+)?(?:\s*(?:million|billion|thousand|k|m|bn))?\b/gi,
  // Percentages and plain numbers (incl. thousands separators and decimals)
  /\b\d[\d,]*(?:\.\d+)?%?\b/g,
  // URLs
  /\bhttps?:\/\/\S+\b/g,
  // Inline code
  /`[^`\n]+`/g,
  // Quoted strings (straight or curly double quotes)
  /"[^"\n]{2,200}"|“[^”\n]{2,200}”/g,
  // Proper-noun phrases: runs of 1-4 capitalised words, not sentence-initial.
  /\b(?:[A-Z][a-zA-Z.]*)(?:\s+[A-Z][a-zA-Z.]*){0,3}\b/g,
];

const SENTENCE_START = /(^|[.!?]\s+)([A-Z][a-zA-Z.]*)/g;

function collectSpans(text: string): Span[] {
  const spans: Span[] = [];

  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      spans.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
      if (match[0].length === 0) pattern.lastIndex++;
    }
  }

  // Drop proper-noun matches that are only the first word of a sentence
  // (likely an ordinary capitalised sentence start, not a name).
  const sentenceStarts = new Set<number>();
  SENTENCE_START.lastIndex = 0;
  let startMatch: RegExpExecArray | null;
  while ((startMatch = SENTENCE_START.exec(text)) !== null) {
    sentenceStarts.add(startMatch.index + startMatch[1].length);
  }

  const filtered = spans.filter((s) => {
    const isSingleCapWord = /^[A-Z][a-zA-Z.]*$/.test(s.text);
    return !(isSingleCapWord && sentenceStarts.has(s.start));
  });

  // Merge overlapping/adjacent spans, preferring earlier start then longer length.
  filtered.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of filtered) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) {
      if (span.end > last.end) {
        last.end = span.end;
        last.text = text.slice(last.start, last.end);
      }
      continue;
    }
    merged.push({ ...span });
  }

  return merged;
}

export interface ProtectResult {
  protectedText: string;
  facts: string[];
}

/**
 * Wraps numbers, dates, money, quotes, URLs, code and proper-noun phrases in
 * ⟦keep⟧…⟦/keep⟧ so the rewrite passes copy them through untouched, and
 * returns the flat list of facts the post-check verifies survive.
 */
export function protectParagraph(text: string): ProtectResult {
  const spans = collectSpans(text);
  if (spans.length === 0) return { protectedText: text, facts: [] };

  let protectedText = "";
  let cursor = 0;
  const facts: string[] = [];
  for (const span of spans) {
    protectedText += text.slice(cursor, span.start);
    protectedText += `⟦keep⟧${span.text}⟦/keep⟧`;
    facts.push(span.text);
    cursor = span.end;
  }
  protectedText += text.slice(cursor);

  return { protectedText, facts };
}

export function stripKeepMarkers(text: string): string {
  return text.replace(/⟦keep⟧/g, "").replace(/⟦\/keep⟧/g, "");
}

export function extractKeepSpans(text: string): string[] {
  const matches = text.match(/⟦keep⟧([^⟦]*)⟦\/keep⟧/g) ?? [];
  return matches.map((m) => m.replace(/⟦keep⟧|⟦\/keep⟧/g, ""));
}
