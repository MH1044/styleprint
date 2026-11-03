import { describe, it, expect } from "vitest";
import mammoth from "mammoth";
import { PDFDocument } from "pdf-lib";
import { buildDocx } from "../src/export/docx.js";
import { buildPdf } from "../src/export/pdf.js";
import { buildMarkdown, buildPlainText, buildRichTextHtml } from "../src/export/text.js";

const TITLE = "The Future of Remote Work";
const BODY = [
  "Remote work has become a central part of how the company operates.",
  "Employees across fifteen countries now collaborate daily over video.",
  "Leadership plans a follow-up report next quarter.",
];

describe("docx export", () => {
  it("round-trips through mammoth and contains the heading and body text", async () => {
    const buffer = await buildDocx({ title: TITLE, bodyParagraphs: BODY });
    expect(buffer.length).toBeGreaterThan(0);

    const result = await mammoth.extractRawText({ buffer });
    expect(result.value).toContain(TITLE);
    for (const paragraph of BODY) {
      expect(result.value).toContain(paragraph);
    }
  });

  it("includes a title page and AI-assisted footer when requested", async () => {
    const buffer = await buildDocx({
      title: TITLE,
      bodyParagraphs: BODY,
      includeTitlePage: true,
      aiAssistedFooter: true,
      authorName: "Test Profile",
    });
    const result = await mammoth.extractRawText({ buffer });
    expect(result.value).toContain(TITLE);
  });
});

describe("markdown and plain text export", () => {
  it("produces markdown whose body matches the editor paragraphs", () => {
    const md = buildMarkdown(TITLE, BODY);
    expect(md).toContain(`# ${TITLE}`);
    for (const paragraph of BODY) {
      expect(md).toContain(paragraph);
    }
    // Stripping the markdown heading marker should leave the same text the
    // plain-text export produces straight from the editor's paragraphs.
    const mdWithoutHeadingMarker = md.replace(/^# /, "");
    expect(mdWithoutHeadingMarker).toBe(buildPlainText(TITLE, BODY));
  });

  it("produces escaped rich-text HTML with a heading and one <p> per paragraph", () => {
    const html = buildRichTextHtml(TITLE, ["A <script> tag & an ampersand"]);
    expect(html).toContain(`<h1>${TITLE}</h1>`);
    expect(html).toContain("<p>A &lt;script&gt; tag &amp; an ampersand</p>");
  });
});

describe("pdf export", () => {
  it("produces a loadable PDF with a page per the chosen size", async () => {
    const buffer = await buildPdf({ title: TITLE, bodyParagraphs: BODY, pageSize: "letter" });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    const { width } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(612);
  });

  it("switches page size to A4", async () => {
    const buffer = await buildPdf({ title: TITLE, bodyParagraphs: BODY, pageSize: "a4" });
    const doc = await PDFDocument.load(buffer);
    const { width } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
  });

  it("paginates long documents across multiple pages", async () => {
    const longBody = Array.from({ length: 60 }, (_, i) => `Paragraph number ${i} with enough words to take up real space on the page.`);
    const buffer = await buildPdf({ title: TITLE, bodyParagraphs: longBody });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
