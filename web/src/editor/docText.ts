import type { DocNode } from "@styleprint/shared";

/**
 * A document's text for side-by-side comparison: one block per paragraph,
 * heading or list item, footnote references as [n] in reading order.
 */
export function docText(doc: DocNode): string {
  let footnotes = 0;
  const inline = (nodes: DocNode[] | undefined): string =>
    (nodes ?? [])
      .map((n) => {
        if (n.type === "footnote") return `[${++footnotes}]`;
        if (n.type === "hardBreak") return "\n";
        if (n.text) return n.text;
        return inline(n.content);
      })
      .join("");
  const blocks: string[] = [];
  const walk = (node: DocNode) => {
    if (node.type === "paragraph" || node.type === "heading") {
      const text = inline(node.content);
      if (text.trim()) blocks.push(text);
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return blocks.join("\n\n");
}
