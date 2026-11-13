import type Database from "better-sqlite3";
import type { DocNode, Provenance, VersionRecord, VoiceDocument } from "@styleprint/shared";
import {
  createVersion,
  getDocument,
  getVersion,
  listDecisionsByDocument,
  listParagraphsByDocument,
  updateDocumentEditorJson,
} from "../db/repo.js";
import { applyParagraphChange, composeEditorDoc } from "./structure.js";

export function isDocNode(value: unknown): value is DocNode {
  return typeof value === "object" && value !== null && (value as DocNode).type === "doc";
}

/**
 * The editor's document: what it last saved, or, before the editor has ever
 * opened, one built from the draft's structure and the wizard's results.
 */
export function currentEditorDoc(db: Database.Database, document: VoiceDocument): DocNode {
  if (isDocNode(document.editorJson)) return document.editorJson;
  const paragraphs = listParagraphsByDocument(db, document.id);
  const reverted = new Set(
    listDecisionsByDocument(db, document.id)
      .filter((d) => d.action === "revert")
      .map((d) => d.paragraphId)
  );
  return composeEditorDoc(document.draftText, paragraphs, reverted);
}

/** As currentEditorDoc, and saves a newly built document so the editor owns it from then on. */
export function ensureEditorDoc(db: Database.Database, document: VoiceDocument): { doc: DocNode; created: boolean } {
  if (isDocNode(document.editorJson)) return { doc: document.editorJson, created: false };
  const doc = currentEditorDoc(db, document);
  updateDocumentEditorJson(db, document.id, doc, null);
  return { doc, created: true };
}

function latestVersionJson(db: Database.Database, documentId: string): string | null {
  const row = db
    .prepare(`SELECT editor_json FROM versions WHERE document_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(documentId) as { editor_json: string } | undefined;
  return row?.editor_json ?? null;
}

/**
 * Saves a named version. With onlyIfChanged it is skipped when the most
 * recent version already holds exactly this content, so exporting the same
 * text three times doesn't leave three identical entries.
 */
export function saveVersion(
  db: Database.Database,
  documentId: string,
  label: string,
  doc: DocNode,
  { onlyIfChanged = false }: { onlyIfChanged?: boolean } = {}
): VersionRecord | null {
  if (onlyIfChanged && latestVersionJson(db, documentId) === JSON.stringify(doc)) return null;
  return createVersion(db, { documentId, label, editorJson: doc });
}

/** Makes a version the current document, first saving what it replaces so a restore can itself be undone. */
export function restoreVersion(
  db: Database.Database,
  document: VoiceDocument,
  versionId: string
): { doc: DocNode; version: VersionRecord } | null {
  const version = getVersion(db, document.id, versionId);
  if (!version || !isDocNode(version.editorJson)) return null;
  saveVersion(db, document.id, `Before restoring “${version.label}”`, currentEditorDoc(db, document), { onlyIfChanged: true });
  updateDocumentEditorJson(db, document.id, version.editorJson, null);
  return { doc: version.editorJson, version };
}

/**
 * A wizard decision changed a paragraph's text. If the editor's document
 * already exists, carry the change into it (unless the user has since edited
 * that paragraph by hand in the editor, whose text then wins).
 */
export function syncWizardChange(
  db: Database.Database,
  documentId: string,
  paragraphId: string,
  previousText: string,
  nextText: string,
  provenance: Provenance
): void {
  const document = getDocument(db, documentId);
  if (!document || !isDocNode(document.editorJson)) return;
  const doc = structuredClone(document.editorJson);
  if (applyParagraphChange(doc, paragraphId, previousText, nextText, provenance, document.draftText)) {
    updateDocumentEditorJson(db, documentId, doc, null);
  }
}
