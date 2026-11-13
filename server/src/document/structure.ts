import type { DocNode, ParagraphRecord, Provenance } from "@styleprint/shared";

/**
 * A draft's structure. Headings are kept exactly as written; only paragraphs
 * go through the rewrite (Stage 5: "the pipeline only rewrites text runs
 * inside each block, never the block types themselves"). Markdown footnote
 * definitions (`[^label]: text`) are taken out of the body; their references
 * (`[^label]`) stay in the paragraph text, protected through the rewrite like
 * any other fact, and become real footnotes in the editor and every export.
 */
export type DraftBlock = { kind: "heading"; level: number; text: string } | { kind: "paragraph"; text: string };

export interface DraftStructure {
  blocks: DraftBlock[];
  footnotes: Map<string, string>;
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const FOOTNOTE_DEFINITION = /^\s{0,3}\[\^([^\]\s]+)\]:\s?(.*)$/;
export const FOOTNOTE_REFERENCE = /\[\^([^\]\s]+)\]/g;

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function parseDraft(text: string): DraftStructure {
  const blocks: DraftBlock[] = [];
  const footnotes = new Map<string, string>();
  let paragraph: string[] = [];
  let footnote: { label: string; lines: string[] } | null = null;

  const endParagraph = () => {
    const joined = normalise(paragraph.join(" "));
    if (joined) blocks.push({ kind: "paragraph", text: joined });
    paragraph = [];
  };
  const endFootnote = () => {
    if (footnote) footnotes.set(footnote.label, normalise(footnote.lines.join(" ")));
    footnote = null;
  };

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const definition = FOOTNOTE_DEFINITION.exec(line);
    if (definition) {
      endParagraph();
      endFootnote();
      footnote = { label: definition[1], lines: [definition[2]] };
      continue;
    }
    if (footnote) {
      // A definition runs on until a blank line, as in GitHub-flavoured Markdown.
      if (line.trim()) {
        footnote.lines.push(line.trim());
        continue;
      }
      endFootnote();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      endParagraph();
      blocks.push({ kind: "heading", level: heading[1].length, text: normalise(heading[2]) });
      continue;
    }
    if (!line.trim()) {
      endParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  endParagraph();
  endFootnote();
  return { blocks, footnotes };
}

/** The paragraphs the pipeline rewrites, in order. Their index is the paragraph's `idx`. */
export function draftParagraphs(text: string): string[] {
  return parseDraft(text)
    .blocks.filter((b): b is Extract<DraftBlock, { kind: "paragraph" }> => b.kind === "paragraph")
    .map((b) => b.text);
}

/** Paragraph text to editor inline nodes, turning defined footnote references into footnote nodes. */
export function inlineNodes(text: string, footnotes: Map<string, string>): DocNode[] {
  const nodes: DocNode[] = [];
  let last = 0;
  for (const match of text.matchAll(FOOTNOTE_REFERENCE)) {
    const content = footnotes.get(match[1]);
    if (content === undefined) continue; // no definition: leave the marker as written
    if (match.index > last) nodes.push({ type: "text", text: text.slice(last, match.index) });
    nodes.push({ type: "footnote", attrs: { content } });
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes;
}

export function provenanceOf(paragraph: ParagraphRecord, reverted: boolean): Provenance {
  const final = paragraph.final ?? paragraph.pass2 ?? paragraph.original;
  if (final === paragraph.original) return reverted ? "reverted" : "original";
  if (paragraph.pass2 && final === paragraph.pass2) return "rewritten";
  return "hand-edited";
}

function paragraphNode(text: string, provenance: Provenance, paragraphId: string | null, footnotes: Map<string, string>): DocNode {
  const content = inlineNodes(text, footnotes);
  return {
    type: "paragraph",
    attrs: { provenance, paragraphId },
    ...(content.length > 0 ? { content } : {}),
  };
}

/**
 * Builds the editor's document from the draft's structure and the rewritten
 * paragraphs: headings where the draft had them, each paragraph's current
 * text (after the wizard) with its provenance, footnotes resolved.
 */
export function composeEditorDoc(draftText: string, paragraphs: ParagraphRecord[], revertedIds: Set<string>): DocNode {
  const { blocks, footnotes } = parseDraft(draftText);
  const ordered = [...paragraphs].sort((a, b) => a.idx - b.idx);
  const content: DocNode[] = [];
  let next = 0;

  const pushParagraph = (p: ParagraphRecord) =>
    content.push(paragraphNode(p.final ?? p.pass2 ?? p.original, provenanceOf(p, revertedIds.has(p.id)), p.id, footnotes));

  for (const block of blocks) {
    if (block.kind === "heading") {
      const inline = inlineNodes(block.text, footnotes);
      content.push({ type: "heading", attrs: { level: block.level }, ...(inline.length ? { content: inline } : {}) });
    } else if (next < ordered.length) {
      pushParagraph(ordered[next++]);
    } else {
      content.push(paragraphNode(block.text, "original", null, footnotes));
    }
  }
  // Rewritten paragraphs beyond the draft's own count (a draft segmented by an
  // earlier version) still belong in the document.
  while (next < ordered.length) pushParagraph(ordered[next++]);

  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

/** Text plus footnote contents, enough to tell whether two runs of inline content say the same thing. */
function inlineSignature(nodes: DocNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => (n.type === "footnote" ? `\u0000${String(n.attrs?.content ?? "")}\u0000` : (n.text ?? "")))
    .join("");
}

/**
 * Carries a wizard decision into an editor document that already exists,
 * unless the user has since changed that paragraph by hand in the editor, in
 * which case their editor text wins. Returns whether anything changed.
 */
export function applyParagraphChange(
  doc: DocNode,
  paragraphId: string,
  previousText: string,
  nextText: string,
  provenance: Provenance,
  draftText: string
): boolean {
  const node = doc.content?.find((n) => n.type === "paragraph" && n.attrs?.paragraphId === paragraphId);
  if (!node) return false;
  const { footnotes } = parseDraft(draftText);
  if (inlineSignature(node.content) !== inlineSignature(inlineNodes(previousText, footnotes))) return false;
  const content = inlineNodes(nextText, footnotes);
  if (content.length > 0) node.content = content;
  else delete node.content;
  node.attrs = { ...node.attrs, provenance };
  return true;
}
