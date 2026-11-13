import type Database from "better-sqlite3";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  style_json TEXT,
  style_card TEXT,
  lora_path TEXT,
  learned_json TEXT
);

CREATE TABLE IF NOT EXISTS samples (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_path TEXT,
  tag TEXT NOT NULL DEFAULT 'other',
  text TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  flagged_ai INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  sample_id TEXT NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  draft_text TEXT NOT NULL,
  editor_json TEXT,
  voice_match REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paragraphs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  original TEXT NOT NULL,
  pass1 TEXT,
  pass2 TEXT,
  final TEXT,
  confidence REAL,
  unsure_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  paragraph_id TEXT NOT NULL REFERENCES paragraphs(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  steer TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  editor_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spend (
  id TEXT PRIMARY KEY,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  call TEXT NOT NULL,
  tier TEXT NOT NULL,
  charge_micros INTEGER NOT NULL,
  balance_after_micros INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_samples_profile ON samples(profile_id);
CREATE INDEX IF NOT EXISTS idx_chunks_sample ON chunks(sample_id);
CREATE INDEX IF NOT EXISTS idx_documents_profile ON documents(profile_id);
CREATE INDEX IF NOT EXISTS idx_paragraphs_document ON paragraphs(document_id);
CREATE INDEX IF NOT EXISTS idx_decisions_document ON decisions(document_id);
CREATE INDEX IF NOT EXISTS idx_versions_document ON versions(document_id);
CREATE INDEX IF NOT EXISTS idx_spend_document ON spend(document_id);
`;

export const TABLES = [
  "profiles",
  "samples",
  "chunks",
  "documents",
  "paragraphs",
  "decisions",
  "versions",
  "spend",
] as const;

/**
 * Columns added after the first release. CREATE TABLE IF NOT EXISTS never
 * alters a table that already exists, so a database created by an earlier
 * version gets them here instead. Idempotent, run on every open.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: "profiles", column: "learned_json", definition: "TEXT" },
];

export function migrate(db: Database.Database): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    }
  }
}
