const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "that", "this",
  "for", "on", "with", "as", "was", "at", "by", "be", "are", "were", "i",
]);

function tokenize(doc: string): string[] {
  const matches = doc.toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g) ?? [];
  return matches.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Local embeddings fallback when publik's /embeddings is unavailable (mock
 * mode or an error). Builds TF-IDF vectors jointly over all given documents
 * so the resulting vectors share one vector space and are directly
 * comparable with cosine similarity. No model call, brute force, instant
 * for the corpus sizes this app deals with.
 */
export function tfidfVectors(docs: string[], maxTerms = 500): number[][] {
  const tokenizedDocs = docs.map(tokenize);

  const documentFrequency = new Map<string, number>();
  for (const tokens of tokenizedDocs) {
    for (const term of new Set(tokens)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const vocabulary = [...documentFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([term]) => term);
  const vocabIndex = new Map(vocabulary.map((term, i) => [term, i]));

  const docCount = docs.length;
  const idf = vocabulary.map((term) => Math.log((docCount + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1);

  return tokenizedDocs.map((tokens) => {
    const vector = new Array(vocabulary.length).fill(0) as number[];
    if (tokens.length === 0) return vector;
    const termCounts = new Map<string, number>();
    for (const t of tokens) termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
    for (const [term, count] of termCounts) {
      const idx = vocabIndex.get(term);
      if (idx === undefined) continue;
      vector[idx] = (count / tokens.length) * idf[idx];
    }
    return vector;
  });
}
