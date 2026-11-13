import { draftParagraphs } from "../document/structure.js";

/**
 * Segments a draft into the paragraphs the pipeline rewrites. Headings and
 * footnote definitions are structural (Stage 5: "the pipeline only rewrites
 * text runs inside each block, never the block types themselves"), so they
 * stay out of pass 1/2; document/structure.ts puts them back around the
 * rewritten paragraphs when the editor's document is built.
 */
export function segmentDraft(draftText: string): string[] {
  return draftParagraphs(draftText);
}
