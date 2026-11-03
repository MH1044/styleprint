import { Extension } from "@tiptap/react";

export type Provenance = "original" | "rewritten" | "hand-edited";

/**
 * Adds a `data-provenance` attribute to every paragraph node so the editor
 * can show where each paragraph came from (original draft, rewritten by the
 * pipeline, or hand-edited) and tint them in heat view. Stored as a plain
 * HTML attribute so it round-trips through getHTML()/setContent() for
 * autosave, without a custom node type.
 */
export const ProvenanceExtension = Extension.create({
  name: "provenance",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          provenance: {
            default: "original",
            parseHTML: (element: HTMLElement) => element.getAttribute("data-provenance") ?? "original",
            renderHTML: (attributes: Record<string, unknown>) => ({
              "data-provenance": attributes.provenance ?? "original",
            }),
          },
        },
      },
    ];
  },
});
