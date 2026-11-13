import type { DocNode } from "@styleprint/shared";

/**
 * Every export renders from the editor's document tree (Stage 6: "generated
 * locally from the editor's JSON tree"), flattened here into the handful of
 * block kinds the formats share. Footnotes are numbered in reading order.
 */
export type Inline =
  | { kind: "text"; text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string }
  | { kind: "footnote"; n: number };

export type ExportBlock =
  | { kind: "heading"; level: number; inlines: Inline[] }
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "quote"; paragraphs: Inline[][] }
  | { kind: "code"; text: string }
  | { kind: "table"; rows: { header: boolean; cells: Inline[][] }[] }
  | { kind: "rule" };

export interface ExportDoc {
  title: string;
  blocks: ExportBlock[];
  /** footnotes[i] is the text of footnote number i + 1. */
  footnotes: string[];
}

export function buildExportDoc(title: string, doc: DocNode): ExportDoc {
  const footnotes: string[] = [];

  const inlines = (nodes: DocNode[] | undefined): Inline[] => {
    const out: Inline[] = [];
    for (const node of nodes ?? []) {
      if (node.type === "text" && node.text) {
        const marks = new Map((node.marks ?? []).map((m) => [m.type, m]));
        const href = marks.get("link")?.attrs?.href;
        out.push({
          kind: "text",
          text: node.text,
          ...(marks.has("bold") ? { bold: true } : {}),
          ...(marks.has("italic") ? { italic: true } : {}),
          ...(marks.has("code") ? { code: true } : {}),
          ...(typeof href === "string" ? { href } : {}),
        });
      } else if (node.type === "hardBreak") {
        out.push({ kind: "text", text: "\n" });
      } else if (node.type === "footnote") {
        footnotes.push(String(node.attrs?.content ?? ""));
        out.push({ kind: "footnote", n: footnotes.length });
      }
    }
    return out;
  };

  /** All the inline content inside a block container (list item, cell, quote), paragraphs joined by a space. */
  const flatten = (node: DocNode): Inline[] => {
    const parts: Inline[][] = [];
    for (const child of node.content ?? []) {
      if (child.type === "paragraph" || child.type === "heading") parts.push(inlines(child.content));
      else if (child.content) parts.push(flatten(child));
    }
    return parts.filter((p) => p.length > 0).flatMap((p, i) => (i === 0 ? p : [{ kind: "text", text: " " } as Inline, ...p]));
  };

  const listItems = (list: DocNode): Inline[][] =>
    (list.content ?? []).flatMap((item) => {
      const own: DocNode = { type: "listItem", content: (item.content ?? []).filter((c) => !c.type.endsWith("List")) };
      const nested = (item.content ?? []).filter((c) => c.type.endsWith("List")).flatMap(listItems);
      return [flatten(own), ...nested];
    });

  const blocks: ExportBlock[] = [];
  for (const node of doc.content ?? []) {
    switch (node.type) {
      case "heading": {
        const content = inlines(node.content);
        if (content.length) blocks.push({ kind: "heading", level: Number(node.attrs?.level ?? 1), inlines: content });
        break;
      }
      case "paragraph": {
        const content = inlines(node.content);
        if (content.length) blocks.push({ kind: "paragraph", inlines: content });
        break;
      }
      case "bulletList":
      case "orderedList":
        blocks.push({ kind: "list", ordered: node.type === "orderedList", items: listItems(node) });
        break;
      case "blockquote":
        blocks.push({
          kind: "quote",
          paragraphs: (node.content ?? []).map((c) => (c.type === "paragraph" ? inlines(c.content) : flatten(c))).filter((p) => p.length),
        });
        break;
      case "codeBlock":
        blocks.push({ kind: "code", text: (node.content ?? []).map((c) => c.text ?? "").join("") });
        break;
      case "table":
        blocks.push({
          kind: "table",
          rows: (node.content ?? []).map((row) => ({
            header: (row.content ?? []).every((cell) => cell.type === "tableHeader"),
            cells: (row.content ?? []).map(flatten),
          })),
        });
        break;
      case "horizontalRule":
        blocks.push({ kind: "rule" });
        break;
      default:
        if (node.content) {
          const content = flatten(node);
          if (content.length) blocks.push({ kind: "paragraph", inlines: content });
        }
    }
  }
  return { title, blocks, footnotes };
}

/** Inline content as plain text, footnote references as [n]. */
export function plainInlines(inlines: Inline[]): string {
  return inlines.map((i) => (i.kind === "footnote" ? `[${i.n}]` : i.text)).join("");
}

/** A document from plain paragraphs, for callers that have no editor tree. */
export function docFromParagraphs(paragraphs: string[]): DocNode {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] })),
  };
}
