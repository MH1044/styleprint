import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nearestParagraphs } from "../src/embeddings/index.js";
import { tfidfVectors } from "../src/embeddings/tfidf.js";
import { splitIntoParagraphs } from "../src/ingest/split.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(__dirname, "../../fixtures/corpus");

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.STYLEPRINT_MOCK = "1";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function allFixtureParagraphs(): string[] {
  const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".md"));
  return files.flatMap((f) => splitIntoParagraphs(fs.readFileSync(path.join(CORPUS_DIR, f), "utf8")));
}

describe("nearestParagraphs (TF-IDF fallback in mock mode)", () => {
  it("returns a fixture paragraph as its own nearest neighbour, ranked first", async () => {
    const paragraphs = allFixtureParagraphs();
    const query = paragraphs[5];
    const candidates = paragraphs.map((text, i) => ({ id: `p${i}`, text }));

    const results = await nearestParagraphs(query, candidates, 5);

    expect(results.length).toBe(5);
    expect(results[0].text).toBe(query);
    expect(results[0].score).toBeCloseTo(1.0, 6);
    // Scores are sorted descending.
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("ranks a topically related paragraph above an unrelated one", async () => {
    const candidates = [
      { id: "a", text: "The lake house trip was ruined by rain and a tent that barely stood up at all." },
      { id: "b", text: "I learned to replace a kitchen faucet after the garbage disposal finally died on a Sunday." },
      { id: "c", text: "Quitting my corporate job to open a coffee shop taught me more than nine years in an office ever did." },
    ];
    const query = "We went camping by the lake and the tent leaked all night in the rain.";

    const results = await nearestParagraphs(query, candidates, 3);
    expect(results[0].id).toBe("a");
  });

  it("returns an empty list for no candidates", async () => {
    const results = await nearestParagraphs("anything", [], 5);
    expect(results).toEqual([]);
  });
});

describe("tfidfVectors", () => {
  it("produces equal-length vectors sharing one vocabulary", () => {
    const docs = ["the cat sat on the mat", "the dog sat on the log", "completely different sentence here"];
    const vectors = tfidfVectors(docs);
    expect(vectors).toHaveLength(docs.length);
    const lengths = new Set(vectors.map((v) => v.length));
    expect(lengths.size).toBe(1);
  });

  it("gives identical documents identical vectors", () => {
    const docs = ["hello world this is a test", "hello world this is a test", "something unrelated entirely"];
    const vectors = tfidfVectors(docs);
    expect(vectors[0]).toEqual(vectors[1]);
  });
});
