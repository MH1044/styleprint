import { describe, it, expect, afterEach } from "vitest";
import type Database from "better-sqlite3";
import type { DocNode, ParagraphRecord } from "@styleprint/shared";
import { openTestDb } from "../src/db/client.js";
import {
  createDecision,
  createDocument,
  createParagraph,
  createProfile,
  getDocument,
  listVersionSummaries,
  updateParagraph,
} from "../src/db/repo.js";
import { applyParagraphChange, composeEditorDoc, parseDraft } from "../src/document/structure.js";
import { ensureEditorDoc, restoreVersion, saveVersion, syncWizardChange } from "../src/document/service.js";
import { segmentDraft } from "../src/pipeline/segment.js";
import { protectParagraph } from "../src/pipeline/protect.js";
import { buildExportDoc } from "../src/export/model.js";
import { buildMarkdown } from "../src/export/text.js";

const DRAFT = `# Remote work at Northwind

Northwind reported that 54% of staff work remotely.[^survey] Most of them are in Denver.

## What changed

Leadership invested $1.4 million in video gear.[^budget]
Productivity rose by 11%.

An undefined note stays as written.[^missing]

[^survey]: Internal staff survey,
  June 2026.
[^budget]: FY2026 budget, line 14.
`;

function paragraph(idx: number, original: string, patch: Partial<ParagraphRecord> = {}): ParagraphRecord {
  return {
    id: `p${idx}`,
    documentId: "d",
    idx,
    original,
    pass1: null,
    pass2: null,
    final: null,
    confidence: null,
    unsureJson: null,
    status: "done",
    ...patch,
  };
}

const textOf = (node: DocNode): string =>
  (node.content ?? []).map((n) => (n.type === "footnote" ? `{${String(n.attrs?.content)}}` : (n.text ?? ""))).join("");

describe("draft structure", () => {
  it("separates headings, paragraphs and footnote definitions", () => {
    const { blocks, footnotes } = parseDraft(DRAFT.replace(/\n/g, "\r\n"));
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "Remote work at Northwind" },
      { kind: "paragraph", text: "Northwind reported that 54% of staff work remotely.[^survey] Most of them are in Denver." },
      { kind: "heading", level: 2, text: "What changed" },
      { kind: "paragraph", text: "Leadership invested $1.4 million in video gear.[^budget] Productivity rose by 11%." },
      { kind: "paragraph", text: "An undefined note stays as written.[^missing]" },
    ]);
    expect(Object.fromEntries(footnotes)).toEqual({
      survey: "Internal staff survey, June 2026.",
      budget: "FY2026 budget, line 14.",
    });
  });

  it("gives the pipeline only the paragraphs, footnote references still in place", () => {
    expect(segmentDraft(DRAFT)).toHaveLength(3);
    expect(segmentDraft(DRAFT)[0]).toContain("[^survey]");
  });

  it("protects footnote references through the rewrite like any other fact", () => {
    const { protectedText, facts } = protectParagraph(segmentDraft(DRAFT)[0]);
    expect(protectedText).toContain("⟦keep⟧[^survey]⟦/keep⟧");
    expect(facts).toContain("[^survey]");
  });
});

describe("the editor's document", () => {
  const paragraphs = [
    paragraph(0, "Northwind reported that 54% of staff work remotely.[^survey] Most of them are in Denver.", {
      pass2: "Most Northwind staff are in Denver, and 54% work remotely.[^survey]",
      final: "Most Northwind staff are in Denver, and 54% work remotely.[^survey]",
    }),
    paragraph(1, "Leadership invested $1.4 million in video gear.[^budget] Productivity rose by 11%.", {
      pass2: "Video gear got $1.4 million.[^budget] Productivity is up 11%.",
      final: "Leadership invested $1.4 million in video gear.[^budget] Productivity rose by 11%.",
    }),
    paragraph(2, "An undefined note stays as written.[^missing]", { pass2: "x", final: "Edited by hand.[^missing]" }),
  ];

  it("puts headings back around the rewritten paragraphs, with provenance and real footnotes", () => {
    const doc = composeEditorDoc(DRAFT, paragraphs, new Set(["p1"]));
    expect(doc.content?.map((n) => n.type)).toEqual(["heading", "paragraph", "heading", "paragraph", "paragraph"]);
    expect(doc.content?.[0].attrs).toEqual({ level: 1 });
    expect(textOf(doc.content![1])).toBe("Most Northwind staff are in Denver, and 54% work remotely.{Internal staff survey, June 2026.}");
    expect(doc.content?.[1].attrs).toEqual({ provenance: "rewritten", paragraphId: "p0" });
    expect(doc.content?.[3].attrs?.provenance).toBe("reverted");
    expect(doc.content?.[4].attrs?.provenance).toBe("hand-edited");
    expect(textOf(doc.content![4])).toBe("Edited by hand.[^missing]");
  });

  it("carries a later wizard change into the editor unless the paragraph was edited there by hand", () => {
    const doc = composeEditorDoc(DRAFT, paragraphs, new Set());
    const before = "Most Northwind staff are in Denver, and 54% work remotely.[^survey]";
    expect(applyParagraphChange(doc, "p0", before, "Reverted text.[^survey]", "reverted", DRAFT)).toBe(true);
    expect(textOf(doc.content![1])).toBe("Reverted text.{Internal staff survey, June 2026.}");
    expect(doc.content?.[1].attrs?.provenance).toBe("reverted");

    doc.content![1].content = [{ type: "text", text: "The user rewrote this in the editor." }];
    expect(applyParagraphChange(doc, "p0", "Reverted text.[^survey]", "Wizard text.", "rewritten", DRAFT)).toBe(false);
    expect(textOf(doc.content![1])).toBe("The user rewrote this in the editor.");
  });

  it("exports the composed document with its headings and footnotes intact", () => {
    const md = buildMarkdown(buildExportDoc("Northwind", composeEditorDoc(DRAFT, paragraphs, new Set())));
    expect(md).toContain("# Remote work at Northwind");
    expect(md).toContain("## What changed");
    expect(md).toContain("remotely.[^1]");
    expect(md).toContain("[^1]: Internal staff survey, June 2026.\n[^2]: FY2026 budget, line 14.");
  });
});

describe("document versions", () => {
  let db: Database.Database;
  afterEach(() => db?.close());

  function seed() {
    db = openTestDb();
    const profile = createProfile(db, "Voice");
    const document = createDocument(db, { profileId: profile.id, title: "Doc", draftText: DRAFT });
    const rows = segmentDraft(DRAFT).map((original, idx) => {
      const row = createParagraph(db, { documentId: document.id, idx, original });
      updateParagraph(db, row.id, { pass2: `Rewritten ${idx}.`, final: `Rewritten ${idx}.`, status: "done" });
      return row;
    });
    return { document, rows };
  }

  it("builds the editor's document once, then keeps what the editor saved", () => {
    const { document } = seed();
    const first = ensureEditorDoc(db, document);
    expect(first.created).toBe(true);
    const saved = getDocument(db, document.id)!;
    expect(saved.editorJson).toEqual(first.doc);
    expect(ensureEditorDoc(db, saved).created).toBe(false);
  });

  it("skips a version identical to the latest one, and restoring saves what it replaces", () => {
    const { document } = seed();
    const { doc } = ensureEditorDoc(db, document);
    const wizard = saveVersion(db, document.id, "Wizard finished", doc, { onlyIfChanged: true });
    expect(wizard).not.toBeNull();
    expect(saveVersion(db, document.id, "Exported as .md", doc, { onlyIfChanged: true })).toBeNull();

    const edited: DocNode = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Typed in the editor." }] }] };
    db.prepare(`UPDATE documents SET editor_json = ? WHERE id = ?`).run(JSON.stringify(edited), document.id);

    const restored = restoreVersion(db, getDocument(db, document.id)!, wizard!.id);
    expect(restored?.doc).toEqual(doc);
    expect(getDocument(db, document.id)!.editorJson).toEqual(doc);
    expect(listVersionSummaries(db, document.id).map((v) => v.label)).toEqual([
      "Before restoring “Wizard finished”",
      "Wizard finished",
    ]);
  });

  it("applies a wizard decision made after the editor opened", () => {
    const { document, rows } = seed();
    ensureEditorDoc(db, document);
    createDecision(db, { documentId: document.id, paragraphId: rows[0].id, action: "revert", steer: null });
    syncWizardChange(db, document.id, rows[0].id, "Rewritten 0.", rows[0].original, "reverted");
    const doc = getDocument(db, document.id)!.editorJson as DocNode;
    const node = doc.content!.find((n) => n.attrs?.paragraphId === rows[0].id)!;
    expect(textOf(node)).toBe("Northwind reported that 54% of staff work remotely.{Internal staff survey, June 2026.} Most of them are in Denver.");
  });
});
