import { describe, it, expect, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { openTestDb } from "../src/db/client.js";
import { TABLES } from "../src/db/schema.js";
import {
  createProfile,
  createSample,
  createChunk,
  createDocument,
  createParagraph,
  createDecision,
  createVersion,
  createSpend,
} from "../src/db/repo.js";

let db: Database.Database;

afterEach(() => {
  db?.close();
});

describe("db schema", () => {
  it("creates all eight tables", () => {
    db = openTestDb();
    const rows = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual([...TABLES].sort());
  });

  it("creates and reads one row per table", () => {
    db = openTestDb();

    const profile = createProfile(db, "Test Profile");
    expect(db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(profile.id)).toBeTruthy();

    const sample = createSample(db, {
      profileId: profile.id,
      title: "sample one",
      sourcePath: null,
      tag: "essay",
      text: "Some sample text.",
      wordCount: 3,
      flaggedAi: false,
    });
    expect(db.prepare(`SELECT * FROM samples WHERE id = ?`).get(sample.id)).toBeTruthy();

    const chunk = createChunk(db, {
      sampleId: sample.id,
      kind: "sentence",
      text: "Some sample text.",
      embedding: [0.1, 0.2, 0.3],
    });
    expect(db.prepare(`SELECT * FROM chunks WHERE id = ?`).get(chunk.id)).toBeTruthy();

    const document = createDocument(db, {
      profileId: profile.id,
      title: "doc one",
      draftText: "A draft.",
    });
    expect(db.prepare(`SELECT * FROM documents WHERE id = ?`).get(document.id)).toBeTruthy();

    const paragraph = createParagraph(db, {
      documentId: document.id,
      idx: 0,
      original: "A draft.",
    });
    expect(db.prepare(`SELECT * FROM paragraphs WHERE id = ?`).get(paragraph.id)).toBeTruthy();

    const decision = createDecision(db, {
      documentId: document.id,
      paragraphId: paragraph.id,
      action: "keep",
      steer: null,
    });
    expect(db.prepare(`SELECT * FROM decisions WHERE id = ?`).get(decision.id)).toBeTruthy();

    const version = createVersion(db, {
      documentId: document.id,
      label: "v1",
      editorJson: { type: "doc", content: [] },
    });
    expect(db.prepare(`SELECT * FROM versions WHERE id = ?`).get(version.id)).toBeTruthy();

    const spend = createSpend(db, {
      documentId: document.id,
      call: "pass1",
      tier: "publik-balanced",
      chargeMicros: 10000,
      balanceAfterMicros: 990000,
    });
    expect(db.prepare(`SELECT * FROM spend WHERE id = ?`).get(spend.id)).toBeTruthy();
  });

  it("enforces foreign keys with cascade delete", () => {
    db = openTestDb();
    const profile = createProfile(db, "Cascade Profile");
    const sample = createSample(db, {
      profileId: profile.id,
      title: "s",
      sourcePath: null,
      tag: "other",
      text: "text",
      wordCount: 1,
      flaggedAi: false,
    });
    createChunk(db, { sampleId: sample.id, kind: "sentence", text: "text", embedding: [] });

    db.prepare(`DELETE FROM profiles WHERE id = ?`).run(profile.id);

    const remainingSamples = db.prepare(`SELECT * FROM samples WHERE profile_id = ?`).all(profile.id);
    const remainingChunks = db.prepare(`SELECT * FROM chunks WHERE sample_id = ?`).all(sample.id);
    expect(remainingSamples).toHaveLength(0);
    expect(remainingChunks).toHaveLength(0);
  });
});
