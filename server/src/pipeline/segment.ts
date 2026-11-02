import { splitIntoParagraphs, stripMarkdownHeadings } from "../ingest/split.js";

/**
 * Segments a draft into the paragraphs the pipeline rewrites. Headings are
 * structural (Stage 5: "the pipeline only rewrites text runs inside each
 * block, never the block types themselves") and are stripped here rather
 * than fed through pass 1/2; the editor is what reattaches real document
 * structure around the rewritten paragraphs.
 */
export function segmentDraft(draftText: string): string[] {
  return splitIntoParagraphs(stripMarkdownHeadings(draftText));
}
