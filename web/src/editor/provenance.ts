import { Extension, combineTransactionSteps, findChildrenInRange, getChangedRanges } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Provenance } from "@styleprint/shared";

export type { Provenance };

/**
 * Per-paragraph provenance (Stage 5): where each paragraph came from
 * (original draft, rewritten, reverted, or hand-edited) for the heat view,
 * plus the id of the pipeline paragraph it holds, so a later wizard decision
 * can find it. Stored as plain attributes so they round-trip through the
 * editor's saved JSON.
 *
 * Typing in a paragraph marks it hand-edited. Loading or restoring a
 * document doesn't: those replace the content with update events off, and
 * this plugin skips them.
 */
export const ProvenanceExtension = Extension.create({
  name: "provenance",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          provenance: {
            default: "hand-edited",
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-provenance") ?? "hand-edited",
            renderHTML: (attributes: Record<string, unknown>) => ({ "data-provenance": attributes.provenance ?? "hand-edited" }),
          },
          paragraphId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-paragraph-id"),
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.paragraphId ? { "data-paragraph-id": attributes.paragraphId } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("provenance-hand-edited"),
        appendTransaction: (transactions, oldState, newState) => {
          const typed = transactions.filter((tr) => tr.docChanged && !tr.getMeta("preventUpdate"));
          if (typed.length === 0) return null;
          const transform = combineTransactionSteps(oldState.doc, typed);
          const tr = newState.tr;
          for (const { newRange } of getChangedRanges(transform)) {
            for (const { node, pos } of findChildrenInRange(newState.doc, newRange, (n) => n.type.name === "paragraph")) {
              if (node.attrs.provenance !== "hand-edited") {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, provenance: "hand-edited" });
              }
            }
          }
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
