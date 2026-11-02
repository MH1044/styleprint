import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { ingestRawText, ingestUpload } from "../src/ingest/pipeline.js";
import { stripBoilerplate, normaliseWhitespace } from "../src/ingest/clean.js";
import { dedupeParagraphs, detectAiLikeSample } from "../src/ingest/analyze.js";
import { splitIntoSentences } from "../src/ingest/split.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(__dirname, "../../fixtures/corpus");

describe("ingest pipeline on fixtures", () => {
  const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".md"));

  it("finds the three fixture corpus files", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of files) {
    it(`yields word counts and chunk counts for ${file}`, async () => {
      const buffer = fs.readFileSync(path.join(CORPUS_DIR, file));
      const result = await ingestUpload(file, buffer, "essay");

      expect(result.wordCount).toBeGreaterThan(400);
      expect(result.wordCount).toBeLessThan(900);
      expect(result.paragraphCount).toBeGreaterThan(3);
      expect(result.chunks.length).toBeGreaterThan(result.paragraphCount);

      const paragraphChunks = result.chunks.filter((c) => c.kind === "paragraph");
      const sentenceChunks = result.chunks.filter((c) => c.kind === "sentence");
      expect(paragraphChunks).toHaveLength(result.paragraphCount);
      expect(sentenceChunks.length).toBeGreaterThan(paragraphChunks.length);
      expect(result.tooShort).toBe(false);
    });
  }
});

describe("ingestUpload file formats", () => {
  it("extracts text from a .docx file", async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("A docx paragraph with more than enough words in it to pass the minimum, repeated a few times so the count clears eighty words total across this single short document sample for the test to be meaningful and stable across runs without flaking on word count thresholds here today now always.")] }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    const result = await ingestUpload("sample.docx", buffer, "report");
    expect(result.wordCount).toBeGreaterThan(10);
    expect(result.cleanedText).toContain("A docx paragraph");
  });

  it("extracts text from a .pdf file", async () => {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page = pdfDoc.addPage();
    page.drawText("Hello from a PDF file. It has two sentences in it.", { x: 50, y: 700, size: 14, font });
    const bytes = await pdfDoc.save();
    const result = await ingestUpload("sample.pdf", Buffer.from(bytes), "report");
    expect(result.cleanedText).toContain("Hello from a PDF file");
    expect(result.cleanedText).not.toMatch(/--\s*\d+\s*of\s*\d+\s*--/);
  });
});

describe("stripBoilerplate", () => {
  it("removes signatures, quoted replies, page numbers and bare URLs", () => {
    const raw = [
      "Real content line one.",
      "Real content line two.",
      "--",
      "John Doe",
      "Sent from my iPhone",
      "",
      "On Tuesday, Jane wrote:",
      "> quoted old message",
      "> more quoted text",
      "",
      "https://example.com/some-link",
      "Page 3 of 12",
      "Final real line.",
    ].join("\n");

    const cleaned = stripBoilerplate(raw);
    expect(cleaned).toContain("Real content line one.");
    expect(cleaned).toContain("Final real line.");
    expect(cleaned).not.toContain("John Doe");
    expect(cleaned).not.toContain("quoted old message");
    expect(cleaned).not.toContain("example.com");
    expect(cleaned).not.toContain("Page 3 of 12");
  });
});

describe("normaliseWhitespace", () => {
  it("collapses runs of spaces and blank lines without touching quote characters", () => {
    const raw = "He said ‘hi’   with   extra   spaces.\n\n\n\nNext paragraph.";
    const cleaned = normaliseWhitespace(raw);
    expect(cleaned).toContain("‘hi’");
    expect(cleaned).not.toMatch(/ {2,}/);
    expect(cleaned).not.toMatch(/\n{3,}/);
  });
});

describe("splitIntoSentences", () => {
  it("does not break on common abbreviations", () => {
    const sentences = splitIntoSentences("Dr. Smith met Mr. Jones at 5 p.m. yesterday. They talked for an hour.");
    expect(sentences).toHaveLength(2);
    expect(sentences[0]).toContain("Dr. Smith met Mr. Jones");
  });

  it("breaks on normal sentence boundaries", () => {
    const sentences = splitIntoSentences("Short one. A little longer than that one. And a third.");
    expect(sentences).toHaveLength(3);
  });
});

describe("dedupeParagraphs", () => {
  it("drops near-identical paragraphs", () => {
    const a = "This is a paragraph about the lake house and the long drive up there.";
    const b = "This is a paragraph about the lake house, and the long drive up there!";
    const c = "A completely unrelated paragraph about something else entirely.";
    const result = dedupeParagraphs([a, b, c]);
    expect(result).toHaveLength(2);
    expect(result).toContain(a);
    expect(result).toContain(c);
  });
});

describe("detectAiLikeSample", () => {
  it("flags uniform, list-heavy paragraphs as AI-like", () => {
    const uniform = [
      "- The first point is this one here today.",
      "- The second point is this one here today.",
      "- The third point is this one here today.",
      "- The fourth point is this one here today.",
    ];
    const result = detectAiLikeSample(uniform);
    expect(result.flagged).toBe(true);
    expect(result.reason).toBeTruthy();
  });

  it("does not flag bursty human prose", () => {
    const human = [
      "Look, I didn't want to go. But I went anyway, because that's apparently who I am now.",
      "Short one.",
      "The drive took forever, the radio broke somewhere around the second hour, and nobody noticed until the silence got weird.",
    ];
    const result = detectAiLikeSample(human);
    expect(result.flagged).toBe(false);
  });
});

describe("ingestRawText minimums", () => {
  it("flags samples under 80 words as too short", () => {
    const result = ingestRawText("short", "Just a few words here, not nearly enough to count as a sample.", "other");
    expect(result.tooShort).toBe(true);
  });
});
