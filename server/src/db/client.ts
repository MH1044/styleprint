import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH, ensureDirs } from "../env.js";
import { SCHEMA_SQL } from "./schema.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  ensureDirs();
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

/** Opens an isolated in-memory database for tests; never touches the user's real file. */
export function openTestDb(): Database.Database {
  const testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");
  testDb.exec(SCHEMA_SQL);
  return testDb;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function fileExists(p: string): boolean {
  return fs.existsSync(p);
}

export function dataDirInfo(): { dbPath: string; dbDir: string } {
  return { dbPath: DB_PATH, dbDir: path.dirname(DB_PATH) };
}
