const ABBREVIATIONS = new Set(
  [
    "mr",
    "mrs",
    "ms",
    "dr",
    "prof",
    "jr",
    "sr",
    "st",
    "vs",
    "etc",
    "eg",
    "ie",
    "inc",
    "ltd",
    "co",
    "no",
    "vol",
    "pp",
    "fig",
    "approx",
    "u.s",
    "u.k",
  ].map((a) => a.toLowerCase())
);

const SENTENCE_END = /([.!?]+)(["')\]]*)(\s+)(?=[A-Z0-9"'(‘“])/g;

export function stripMarkdownHeadings(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s{0,3}#{1,6}\s/.test(line))
    .join("\n")
    .trim();
}

export function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
}

/**
 * Rule-based sentence splitter: breaks on . ! ? followed by whitespace and a
 * capital/number/quote, unless the token just before the break is a known
 * abbreviation. No model call.
 */
export function splitIntoSentences(paragraph: string): string[] {
  const normalised = paragraph.replace(/\s+/g, " ").trim();
  if (!normalised) return [];

  const breakPositions: number[] = [];
  let match: RegExpExecArray | null;
  SENTENCE_END.lastIndex = 0;
  while ((match = SENTENCE_END.exec(normalised)) !== null) {
    const before = normalised.slice(0, match.index);
    const lastWord = before.match(/([A-Za-z]+)\.?$/)?.[1]?.toLowerCase();
    if (lastWord && ABBREVIATIONS.has(lastWord)) continue;
    // Single capital letter followed by a period, e.g. an initial like "J."
    if (/\b[A-Za-z]$/.test(before.replace(/[.!?]+$/, ""))) continue;
    breakPositions.push(match.index + match[1].length + match[2].length);
  }

  if (breakPositions.length === 0) return [normalised];

  const sentences: string[] = [];
  let start = 0;
  for (const pos of breakPositions) {
    sentences.push(normalised.slice(start, pos).trim());
    start = pos;
  }
  const rest = normalised.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences.filter((s) => s.length > 0);
}

export function wordCount(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}
