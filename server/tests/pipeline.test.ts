import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeStyleProfile } from "../src/fingerprint/index.js";
import { generateStyleCard } from "../src/pipeline/styleCard.js";
import { runPipeline } from "../src/pipeline/run.js";
import { splitIntoParagraphs, stripMarkdownHeadings } from "../src/ingest/split.js";
import { segmentDraft } from "../src/pipeline/segment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures");

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.VOICEBOX_MOCK = "1";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function loadCorpus(): { text: string; paragraphs: string[] } {
  const dir = path.join(FIXTURES_DIR, "corpus");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  const texts = files.map((f) => stripMarkdownHeadings(fs.readFileSync(path.join(dir, f), "utf8")));
  const paragraphs = texts.flatMap((t) => splitIntoParagraphs(t));
  return { text: texts.join("\n\n"), paragraphs };
}

const DRAFT_FACTS = [
  "42%",
  "1,200",
  "3.2 million",
  "15 countries",
  "78%",
  "65%",
  "12%",
  "9%",
  "300",
  "Acme Corporation",
  "San Francisco",
  "Microsoft Teams",
  "Austin",
  "Maria Alvarez",
  "Q3 2026",
  "Q1 2027",
];

describe("full pipeline on fixtures/draft.md", () => {
  it("rewrites the draft, keeps every number and name, and raises the voice-match score", async () => {
    const corpus = loadCorpus();
    const styleJson = computeStyleProfile(corpus.text);

    const cardResult = await generateStyleCard(styleJson, corpus.paragraphs);
    expect(cardResult.text.length).toBeGreaterThan(50);

    const draftRaw = fs.readFileSync(path.join(FIXTURES_DIR, "draft.md"), "utf8");
    const draftText = stripMarkdownHeadings(draftRaw);

    const corpusParagraphs = corpus.paragraphs.map((text, i) => ({ id: `corpus-${i}`, text }));

    const result = await runPipeline({
      documentId: "test-doc-1",
      draftText,
      profile: { styleJson, styleCard: cardResult.text },
      corpusParagraphs,
    });

    const expectedParagraphCount = segmentDraft(draftText).length;
    expect(result.paragraphs).toHaveLength(expectedParagraphCount);

    const fullRewrittenText = result.paragraphs.map((p) => p.final).join("\n\n");

    for (const fact of DRAFT_FACTS) {
      expect(fullRewrittenText).toContain(fact);
    }

    for (const paragraph of result.paragraphs) {
      expect(["done", "needs_review"]).toContain(paragraph.status);
      expect(paragraph.final.length).toBeGreaterThan(0);
    }

    expect(result.voiceMatchAfter).toBeGreaterThan(result.voiceMatchBefore);
    expect(result.totalChargeMicros).toBeGreaterThan(0);
  }, 30000);
});
