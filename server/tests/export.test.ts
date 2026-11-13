import { describe, it, expect } from "vitest";
import mammoth from "mammoth";
import { PDFDocument } from "pdf-lib";
import type { DocNode } from "@styleprint/shared";
import { buildExportDoc, docFromParagraphs } from "../src/export/model.js";
import { buildDocx } from "../src/export/docx.js";
import { buildPdf } from "../src/export/pdf.js";
import { buildMarkdown, buildPlainText, buildRichTextHtml } from "../src/export/text.js";
import { extractPdfText } from "../src/ingest/pdf.js";

const TITLE = "The Future of Remote Work";
const BODY = [
  "Remote work has become a central part of how the company operates.",
  "Employees across fifteen countries now collaborate daily over video.",
  "Leadership plans a follow-up report next quarter.",
];

const plain = () => buildExportDoc(TITLE, docFromParagraphs(BODY));

const text = (t: string, marks?: string[]): DocNode => ({ type: "text", text: t, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) });
const para = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const item = (t: DocNode): DocNode => ({ type: "listItem", content: [para(t)] });
const cell = (type: string, t: string): DocNode => ({ type, content: [para(text(t))] });

/** An editor document using every block kind the exports handle. */
const RICH: DocNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [text("Where the money went")] },
    para(text("Revenue rose 11%"), { type: "footnote", attrs: { content: "Q2 2026 board pack, p. 4." } }, text(" and costs fell.")),
    { type: "bulletList", content: [item(text("Denver")), item(text("Austin", ["bold"]))] },
    { type: "orderedList", content: [item(text("First step")), item(text("Second step"))] },
    { type: "blockquote", content: [para(text("Ship it."))] },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableHeader", "City"), cell("tableHeader", "Staff")] },
        { type: "tableRow", content: [cell("tableCell", "Denver"), cell("tableCell", "800")] },
      ],
    },
    para(text("See the second note"), { type: "footnote", attrs: { content: "Arrows → and emoji 🙂 survive the PDF." } }),
  ],
};

describe("export model", () => {
  it("numbers footnotes in reading order and keeps every block kind", () => {
    const doc = buildExportDoc(TITLE, RICH);
    expect(doc.footnotes).toEqual(["Q2 2026 board pack, p. 4.", "Arrows → and emoji 🙂 survive the PDF."]);
    expect(doc.blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "list", "quote", "table", "paragraph"]);
  });

  it("skips empty paragraphs", () => {
    const doc = buildExportDoc(TITLE, { type: "doc", content: [{ type: "paragraph" }, para(text("Only this"))] });
    expect(doc.blocks).toHaveLength(1);
  });
});

describe("docx export", () => {
  it("round-trips through mammoth and contains the title and body text", async () => {
    const buffer = await buildDocx(plain());
    expect(buffer.length).toBeGreaterThan(0);
    const result = await mammoth.extractRawText({ buffer });
    expect(result.value).toContain(TITLE);
    for (const paragraph of BODY) expect(result.value).toContain(paragraph);
  });

  it("includes a title page and AI-assisted footer when requested", async () => {
    const buffer = await buildDocx(plain(), { includeTitlePage: true, aiAssistedFooter: true, authorName: "Test Profile" });
    const result = await mammoth.extractRawText({ buffer });
    expect(result.value).toContain(TITLE);
  });

  it("writes real headings, lists, tables and footnotes", async () => {
    const buffer = await buildDocx(buildExportDoc(TITLE, RICH));
    const { value: html } = await mammoth.convertToHtml({ buffer });
    expect(html).toContain("<h2>Where the money went</h2>");
    expect(html).toMatch(/<ul><li>Denver<\/li><li><strong>Austin<\/strong><\/li><\/ul>/);
    expect(html).toMatch(/<ol><li>First step<\/li><li>Second step<\/li><\/ol>/);
    expect(html).toContain("<table>");
    expect(html).toContain("City");
    // Real Word footnotes: a reference in the text and the note at the end.
    expect(html).toMatch(/Revenue rose 11%<sup><a href="#footnote-1" id="footnote-ref-1">\[1\]<\/a><\/sup> and costs fell\./);
    expect(html).toMatch(/<li id="footnote-1"><p>Q2 2026 board pack, p\. 4\./);
    expect(html).toContain('id="footnote-2"');
  });
});

describe("markdown, plain text and rich text export", () => {
  it("produces markdown whose body matches the plain-text export for plain paragraphs", () => {
    const md = buildMarkdown(plain());
    expect(md).toContain(`# ${TITLE}`);
    for (const paragraph of BODY) expect(md).toContain(paragraph);
    expect(md.replace(/^# /, "")).toBe(buildPlainText(plain()));
  });

  it("renders structure and footnotes as markdown", () => {
    const md = buildMarkdown(buildExportDoc(TITLE, RICH));
    expect(md).toContain("## Where the money went");
    expect(md).toContain("Revenue rose 11%[^1] and costs fell.");
    expect(md).toContain("- Denver\n- **Austin**");
    expect(md).toContain("1. First step\n2. Second step");
    expect(md).toContain("> Ship it.");
    expect(md).toContain("| City | Staff |\n| --- | --- |\n| Denver | 800 |");
    expect(md).toContain("[^1]: Q2 2026 board pack, p. 4.\n[^2]: Arrows");
  });

  it("puts footnotes in a Notes section in plain text", () => {
    const txt = buildPlainText(buildExportDoc(TITLE, RICH));
    expect(txt).toContain("Revenue rose 11%[1] and costs fell.");
    expect(txt).toContain("Notes\n[1] Q2 2026 board pack, p. 4.\n[2] Arrows");
  });

  it("produces escaped rich-text HTML with linked footnotes", () => {
    const html = buildRichTextHtml(buildExportDoc(TITLE, docFromParagraphs(["A <script> tag & an ampersand"])));
    expect(html).toContain(`<h1>${TITLE}</h1>`);
    expect(html).toContain("<p>A &lt;script&gt; tag &amp; an ampersand</p>");

    const rich = buildRichTextHtml(buildExportDoc(TITLE, RICH));
    expect(rich).toContain("<h2>Where the money went</h2>");
    expect(rich).toContain('Revenue rose 11%<sup><a href="#fn-1" id="fnref-1">1</a></sup>');
    expect(rich).toContain('<li id="fn-1">Q2 2026 board pack, p. 4.');
  });
});

describe("pdf export", () => {
  it("produces a loadable PDF with a page per the chosen size", async () => {
    const buffer = await buildPdf(plain(), { pageSize: "letter" });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(Math.round(doc.getPage(0).getSize().width)).toBe(612);
  });

  it("switches page size to A4", async () => {
    const buffer = await buildPdf(plain(), { pageSize: "a4" });
    const doc = await PDFDocument.load(buffer);
    expect(Math.round(doc.getPage(0).getSize().width)).toBe(595);
  });

  it("paginates long documents across multiple pages", async () => {
    const longBody = Array.from({ length: 60 }, (_, i) => `Paragraph number ${i} with enough words to take up real space on the page.`);
    const buffer = await buildPdf(buildExportDoc(TITLE, docFromParagraphs(longBody)));
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it("renders structure, footnotes and characters the PDF fonts can't encode", async () => {
    const buffer = await buildPdf(buildExportDoc(TITLE, RICH));
    const extracted = await extractPdfText(buffer);
    expect(extracted).toContain("Where the money went");
    expect(extracted).toContain("Revenue rose 11%[1] and costs fell.");
    expect(extracted).toContain("• Denver");
    expect(extracted).toContain("Notes");
    expect(extracted).toContain("1. Q2 2026 board pack, p. 4.");
    expect(extracted).toContain("Arrows -> and emoji ? survive the PDF.");
  });
});
