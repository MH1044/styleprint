import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Profile,
  Sample,
  Chunk,
  VoiceDocument,
  ParagraphRecord,
  Decision,
  VersionRecord,
  SpendRecord,
  Tag,
  ChunkKind,
  ParagraphStatus,
  DecisionAction,
  ModelTier,
  StyleProfile,
  UnsureSpan,
} from "@voicebox/shared";

interface ProfileRow {
  id: string;
  name: string;
  created_at: string;
  style_json: string | null;
  style_card: string | null;
  lora_path: string | null;
}

function rowToProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    styleJson: r.style_json ? (JSON.parse(r.style_json) as StyleProfile) : null,
    styleCard: r.style_card,
    loraPath: r.lora_path,
  };
}

export function createProfile(db: Database.Database, name: string): Profile {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO profiles (id, name, created_at, style_json, style_card, lora_path) VALUES (?, ?, ?, NULL, NULL, NULL)`
  ).run(id, name, createdAt);
  return { id, name, createdAt, styleJson: null, styleCard: null, loraPath: null };
}

export function getProfile(db: Database.Database, id: string): Profile | null {
  const row = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(id) as ProfileRow | undefined;
  return row ? rowToProfile(row) : null;
}

export function listProfiles(db: Database.Database): Profile[] {
  const rows = db.prepare(`SELECT * FROM profiles ORDER BY created_at DESC`).all() as ProfileRow[];
  return rows.map(rowToProfile);
}

export function updateProfileStyle(
  db: Database.Database,
  id: string,
  styleJson: StyleProfile,
  styleCard: string | null
): void {
  db.prepare(`UPDATE profiles SET style_json = ?, style_card = COALESCE(?, style_card) WHERE id = ?`).run(
    JSON.stringify(styleJson),
    styleCard,
    id
  );
}

interface SampleRow {
  id: string;
  profile_id: string;
  title: string;
  source_path: string | null;
  tag: Tag;
  text: string;
  word_count: number;
  flagged_ai: number;
}

function rowToSample(r: SampleRow): Sample {
  return {
    id: r.id,
    profileId: r.profile_id,
    title: r.title,
    sourcePath: r.source_path,
    tag: r.tag,
    text: r.text,
    wordCount: r.word_count,
    flaggedAi: Boolean(r.flagged_ai),
  };
}

export function createSample(
  db: Database.Database,
  input: Omit<Sample, "id">
): Sample {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO samples (id, profile_id, title, source_path, tag, text, word_count, flagged_ai)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.profileId,
    input.title,
    input.sourcePath,
    input.tag,
    input.text,
    input.wordCount,
    input.flaggedAi ? 1 : 0
  );
  return { id, ...input };
}

export function listSamplesByProfile(db: Database.Database, profileId: string): Sample[] {
  const rows = db
    .prepare(`SELECT * FROM samples WHERE profile_id = ? ORDER BY rowid ASC`)
    .all(profileId) as SampleRow[];
  return rows.map(rowToSample);
}

interface ChunkRow {
  id: string;
  sample_id: string;
  kind: ChunkKind;
  text: string;
  embedding: string;
}

function rowToChunk(r: ChunkRow): Chunk {
  return {
    id: r.id,
    sampleId: r.sample_id,
    kind: r.kind,
    text: r.text,
    embedding: JSON.parse(r.embedding) as number[],
  };
}

export function createChunk(db: Database.Database, input: Omit<Chunk, "id">): Chunk {
  const id = randomUUID();
  db.prepare(`INSERT INTO chunks (id, sample_id, kind, text, embedding) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    input.sampleId,
    input.kind,
    input.text,
    JSON.stringify(input.embedding)
  );
  return { id, ...input };
}

export function listChunksByProfile(db: Database.Database, profileId: string): Chunk[] {
  const rows = db
    .prepare(
      `SELECT c.* FROM chunks c JOIN samples s ON s.id = c.sample_id WHERE s.profile_id = ?`
    )
    .all(profileId) as ChunkRow[];
  return rows.map(rowToChunk);
}

export function updateChunkEmbedding(db: Database.Database, id: string, embedding: number[]): void {
  db.prepare(`UPDATE chunks SET embedding = ? WHERE id = ?`).run(JSON.stringify(embedding), id);
}

export function listChunksBySample(db: Database.Database, sampleId: string): Chunk[] {
  const rows = db.prepare(`SELECT * FROM chunks WHERE sample_id = ?`).all(sampleId) as ChunkRow[];
  return rows.map(rowToChunk);
}

interface DocumentRow {
  id: string;
  profile_id: string;
  title: string;
  draft_text: string;
  editor_json: string | null;
  voice_match: number | null;
  created_at: string;
}

function rowToDocument(r: DocumentRow): VoiceDocument {
  return {
    id: r.id,
    profileId: r.profile_id,
    title: r.title,
    draftText: r.draft_text,
    editorJson: r.editor_json ? JSON.parse(r.editor_json) : null,
    voiceMatch: r.voice_match,
    createdAt: r.created_at,
  };
}

export function createDocument(
  db: Database.Database,
  input: { profileId: string; title: string; draftText: string }
): VoiceDocument {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO documents (id, profile_id, title, draft_text, editor_json, voice_match, created_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?)`
  ).run(id, input.profileId, input.title, input.draftText, createdAt);
  return {
    id,
    profileId: input.profileId,
    title: input.title,
    draftText: input.draftText,
    editorJson: null,
    voiceMatch: null,
    createdAt,
  };
}

export function getDocument(db: Database.Database, id: string): VoiceDocument | null {
  const row = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DocumentRow | undefined;
  return row ? rowToDocument(row) : null;
}

export function updateDocumentEditorJson(
  db: Database.Database,
  id: string,
  editorJson: unknown,
  voiceMatch: number | null
): void {
  db.prepare(`UPDATE documents SET editor_json = ?, voice_match = COALESCE(?, voice_match) WHERE id = ?`).run(
    JSON.stringify(editorJson),
    voiceMatch,
    id
  );
}

interface ParagraphRow {
  id: string;
  document_id: string;
  idx: number;
  original: string;
  pass1: string | null;
  pass2: string | null;
  final: string | null;
  confidence: number | null;
  unsure_json: string | null;
  status: ParagraphStatus;
}

function rowToParagraph(r: ParagraphRow): ParagraphRecord {
  return {
    id: r.id,
    documentId: r.document_id,
    idx: r.idx,
    original: r.original,
    pass1: r.pass1,
    pass2: r.pass2,
    final: r.final,
    confidence: r.confidence,
    unsureJson: r.unsure_json ? (JSON.parse(r.unsure_json) as UnsureSpan[]) : null,
    status: r.status,
  };
}

export function createParagraph(
  db: Database.Database,
  input: { documentId: string; idx: number; original: string }
): ParagraphRecord {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO paragraphs (id, document_id, idx, original, pass1, pass2, final, confidence, unsure_json, status)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 'pending')`
  ).run(id, input.documentId, input.idx, input.original);
  return {
    id,
    documentId: input.documentId,
    idx: input.idx,
    original: input.original,
    pass1: null,
    pass2: null,
    final: null,
    confidence: null,
    unsureJson: null,
    status: "pending",
  };
}

export function getParagraph(db: Database.Database, id: string): ParagraphRecord | null {
  const row = db.prepare(`SELECT * FROM paragraphs WHERE id = ?`).get(id) as ParagraphRow | undefined;
  return row ? rowToParagraph(row) : null;
}

export function listParagraphsByDocument(db: Database.Database, documentId: string): ParagraphRecord[] {
  const rows = db
    .prepare(`SELECT * FROM paragraphs WHERE document_id = ? ORDER BY idx ASC`)
    .all(documentId) as ParagraphRow[];
  return rows.map(rowToParagraph);
}

export function updateParagraph(
  db: Database.Database,
  id: string,
  patch: Partial<Pick<ParagraphRecord, "pass1" | "pass2" | "final" | "confidence" | "unsureJson" | "status">>
): void {
  const current = db.prepare(`SELECT * FROM paragraphs WHERE id = ?`).get(id) as ParagraphRow | undefined;
  if (!current) throw new Error(`paragraph not found: ${id}`);
  db.prepare(
    `UPDATE paragraphs SET pass1 = ?, pass2 = ?, final = ?, confidence = ?, unsure_json = ?, status = ? WHERE id = ?`
  ).run(
    patch.pass1 ?? current.pass1,
    patch.pass2 ?? current.pass2,
    patch.final ?? current.final,
    patch.confidence ?? current.confidence,
    patch.unsureJson ? JSON.stringify(patch.unsureJson) : current.unsure_json,
    patch.status ?? current.status,
    id
  );
}

export function createDecision(
  db: Database.Database,
  input: { documentId: string; paragraphId: string; action: DecisionAction; steer: string | null }
): Decision {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO decisions (id, document_id, paragraph_id, action, steer, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.documentId, input.paragraphId, input.action, input.steer, createdAt);
  return { id, ...input, createdAt };
}

export function listDecisionsByDocument(db: Database.Database, documentId: string): Decision[] {
  const rows = db.prepare(`SELECT * FROM decisions WHERE document_id = ?`).all(documentId) as {
    id: string;
    document_id: string;
    paragraph_id: string;
    action: DecisionAction;
    steer: string | null;
    created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    paragraphId: r.paragraph_id,
    action: r.action,
    steer: r.steer,
    createdAt: r.created_at,
  }));
}

export function createVersion(
  db: Database.Database,
  input: { documentId: string; label: string; editorJson: unknown }
): VersionRecord {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO versions (id, document_id, label, editor_json, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    input.documentId,
    input.label,
    JSON.stringify(input.editorJson),
    createdAt
  );
  return { id, documentId: input.documentId, label: input.label, editorJson: input.editorJson, createdAt };
}

export function listVersionsByDocument(db: Database.Database, documentId: string): VersionRecord[] {
  const rows = db
    .prepare(`SELECT * FROM versions WHERE document_id = ? ORDER BY created_at DESC`)
    .all(documentId) as { id: string; document_id: string; label: string; editor_json: string; created_at: string }[];
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    label: r.label,
    editorJson: JSON.parse(r.editor_json),
    createdAt: r.created_at,
  }));
}

export function createSpend(
  db: Database.Database,
  input: {
    documentId: string | null;
    call: string;
    tier: ModelTier;
    chargeMicros: number;
    balanceAfterMicros: number | null;
  }
): SpendRecord {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO spend (id, document_id, call, tier, charge_micros, balance_after_micros, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.documentId, input.call, input.tier, input.chargeMicros, input.balanceAfterMicros, createdAt);
  return { id, ...input, createdAt };
}

export function listSpendByDocument(db: Database.Database, documentId: string): SpendRecord[] {
  const rows = db.prepare(`SELECT * FROM spend WHERE document_id = ? ORDER BY created_at ASC`).all(documentId) as {
    id: string;
    document_id: string | null;
    call: string;
    tier: ModelTier;
    charge_micros: number;
    balance_after_micros: number | null;
    created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    call: r.call,
    tier: r.tier,
    chargeMicros: r.charge_micros,
    balanceAfterMicros: r.balance_after_micros,
    createdAt: r.created_at,
  }));
}
