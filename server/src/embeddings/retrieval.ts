import { createEmbeddings } from "../ai/client.js";
import { cosineSimilarity } from "../fingerprint/compare.js";
import { tfidfVectors } from "./tfidf.js";

export interface RetrievalCandidate {
  id: string;
  text: string;
  embedding?: number[];
}

export interface RetrievedChunk {
  id: string;
  text: string;
  score: number;
}

/**
 * Finds the k nearest candidates to queryText. Uses stored publik embeddings
 * when every candidate has one; otherwise (mock mode, no stored embeddings,
 * or a publik error) falls back to TF-IDF computed jointly over the query
 * and all candidates so the vectors share one space.
 */
export async function nearestParagraphs(
  queryText: string,
  candidates: RetrievalCandidate[],
  k: number
): Promise<RetrievedChunk[]> {
  if (candidates.length === 0) return [];

  const haveStoredEmbeddings = candidates.every((c) => c.embedding && c.embedding.length > 0);
  if (haveStoredEmbeddings) {
    try {
      const { vectors } = await createEmbeddings([queryText]);
      const queryVector = vectors[0];
      return rank(candidates, (c) => cosineSimilarity(queryVector, c.embedding as number[]), k);
    } catch {
      // Fall through to the local fallback below.
    }
  }

  const docs = [queryText, ...candidates.map((c) => c.text)];
  const vectors = tfidfVectors(docs);
  const queryVector = vectors[0];
  return rank(candidates, (_c, i) => cosineSimilarity(queryVector, vectors[i + 1]), k);
}

function rank(
  candidates: RetrievalCandidate[],
  score: (c: RetrievalCandidate, i: number) => number,
  k: number
): RetrievedChunk[] {
  return candidates
    .map((c, i) => ({ id: c.id, text: c.text, score: score(c, i) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
