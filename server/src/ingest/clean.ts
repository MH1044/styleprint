const URL_ONLY_LINE = /^\s*(https?:\/\/|www\.)\S+\s*$/i;
const PAGE_NUMBER_LINE = /^\s*(page\s+)?\d+(\s*(of|\/)\s*\d+)?\s*$/i;
const SIGNATURE_MARKER = /^\s*--\s*$/;
const QUOTED_REPLY_PREFIX = /^\s*>/;
const QUOTED_REPLY_HEADER = /^\s*On .+ wrote:\s*$/i;
const EMAIL_HEADER_LINE = /^\s*(From|To|Sent|Subject|Cc|Bcc|Date):\s*.*$/i;

/**
 * Strips boilerplate that carries no voice signal: signatures, quoted email
 * replies, headers/footers, standalone page numbers, and link-only lines.
 * Runs entirely locally, no model calls.
 */
export function stripBoilerplate(raw: string): string {
  const lines = raw.split(/\r\n|\r|\n/);
  const kept: string[] = [];
  let inSignature = false;
  let inQuotedReply = false;

  for (const line of lines) {
    if (SIGNATURE_MARKER.test(line)) {
      inSignature = true;
      continue;
    }
    if (inSignature) {
      if (line.trim() === "") inSignature = false;
      continue;
    }

    if (QUOTED_REPLY_HEADER.test(line)) {
      inQuotedReply = true;
      continue;
    }
    if (inQuotedReply) {
      if (line.trim() === "") inQuotedReply = false;
      continue;
    }
    if (QUOTED_REPLY_PREFIX.test(line)) {
      continue;
    }

    if (EMAIL_HEADER_LINE.test(line)) continue;
    if (URL_ONLY_LINE.test(line)) continue;
    if (PAGE_NUMBER_LINE.test(line) && line.trim().length > 0) continue;

    kept.push(line);
  }

  return kept.join("\n");
}

/**
 * Normalises whitespace and encoding without touching the user's own quote
 * or dash characters, which are measured signal, not noise.
 */
export function normaliseWhitespace(text: string): string {
  const unified = text.normalize("NFC").replace(/\r\n|\r/g, "\n");
  const trimmedLines = unified
    .split("\n")
    // Collapse only runs of 3+ spaces/tabs (extraction artefacts); an exact
    // double space is a quirk the fingerprint measures, not noise to erase.
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/[ \t]{3,}/g, " "));
  const collapsed = trimmedLines.join("\n").replace(/\n{3,}/g, "\n\n");
  return collapsed.trim();
}

export function cleanSampleText(raw: string): string {
  return normaliseWhitespace(stripBoilerplate(raw));
}
