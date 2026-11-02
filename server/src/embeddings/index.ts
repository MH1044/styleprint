import type Database from "better-sqlite3";
import { createEmbeddings } from "../ai/client.js";
import { listChunksByProfile, updateChunkEmbedding } from "../db/repo.js";

export { nearestParagraphs } from "./retrieval.js";
export type { RetrievalCandidate, RetrievedChunk } from "./retrieval.js";
export { tfidfVectors } from "./tfidf.js";

export interface IndexResult {
  source: "publik" | "skipped";
  count: number;
}

/**
 * Pre-computes and stores publik embeddings for every paragraph chunk in a
 * profile. Best-effort: in mock mode or on any publik error, this is a
 * no-op and retrieval falls back to on-the-fly TF-IDF instead, per the
 * one-shot build plan's embeddings substitution.
 */
export async function indexProfileEmbeddings(db: Database.Database, profileId: string): Promise<IndexResult> {
  const paragraphChunks = listChunksByProfile(db, profileId).filter((c) => c.kind === "paragraph");
  if (paragraphChunks.length === 0) return { source: "skipped", count: 0 };

  try {
    const { vectors } = await createEmbeddings(paragraphChunks.map((c) => c.text));
    paragraphChunks.forEach((chunk, i) => updateChunkEmbedding(db, chunk.id, vectors[i]));
    return { source: "publik", count: paragraphChunks.length };
  } catch {
    return { source: "skipped", count: 0 };
  }
}
