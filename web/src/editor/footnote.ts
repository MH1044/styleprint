import { Node, mergeAttributes } from "@tiptap/react";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: (content: string) => ReturnType;
    };
  }
}

/**
 * An inline footnote reference that carries its own note text. References
 * are numbered in reading order by a CSS counter (index.css), so adding or
 * deleting one renumbers the rest; the notes list under the editor is read
 * from the same nodes. Exports turn them into real Word footnotes, [^n]
 * Markdown notes, or a Notes section.
 */
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      content: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-footnote") ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-footnote": String(attributes.content ?? "") }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-footnote]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes, { class: "footnote-ref", title: HTMLAttributes["data-footnote"] })];
  },

  // Notes aren't part of the running text (word count, voice check).
  renderText() {
    return "";
  },

  addCommands() {
    return {
      insertFootnote:
        (content: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { content } }),
    };
  },
});
