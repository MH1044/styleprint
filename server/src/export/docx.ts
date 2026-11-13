import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import type { ExportDoc, Inline } from "./model.js";

export interface DocxExportOptions {
  authorName?: string;
  includeTitlePage?: boolean;
  aiAssistedFooter?: boolean;
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

function runs(inlines: Inline[]): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const inline of inlines) {
    if (inline.kind === "footnote") {
      out.push(new FootnoteReferenceRun(inline.n));
      continue;
    }
    inline.text.split("\n").forEach((text, i) => {
      const run = new TextRun({
        text,
        bold: inline.bold,
        italics: inline.italic,
        font: inline.code ? "Consolas" : undefined,
        style: inline.href ? "Hyperlink" : undefined,
        break: i > 0 ? 1 : undefined,
      });
      out.push(inline.href ? new ExternalHyperlink({ link: inline.href, children: [run] }) : run);
    });
  }
  return out;
}

/**
 * Word export with real Word structure (Stage 6): the document title in the
 * Title style, headings as Heading 1-6, list paragraphs on real numbering,
 * quotes in the Quote style, real tables, real footnotes, and page numbers.
 */
export async function buildDocx(doc: ExportDoc, options: DocxExportOptions = {}): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  let orderedLists = 0;

  children.push(new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE, alignment: options.includeTitlePage ? AlignmentType.CENTER : undefined }));
  if (options.includeTitlePage) children.push(new Paragraph({ text: "", pageBreakBefore: true }));

  for (const block of doc.blocks) {
    switch (block.kind) {
      case "heading":
        children.push(new Paragraph({ heading: HEADINGS[Math.min(block.level, 6) - 1], children: runs(block.inlines) }));
        break;
      case "paragraph":
        children.push(new Paragraph({ children: runs(block.inlines) }));
        break;
      case "list": {
        const instance = block.ordered ? ++orderedLists : 0;
        for (const item of block.items) {
          children.push(
            new Paragraph({
              numbering: { reference: block.ordered ? "numbers" : "bullets", level: 0, instance },
              children: runs(item),
            })
          );
        }
        break;
      }
      case "quote":
        for (const p of block.paragraphs) children.push(new Paragraph({ style: "Quote", children: runs(p) }));
        break;
      case "code":
        for (const line of block.text.split("\n")) {
          children.push(new Paragraph({ children: [new TextRun({ text: line, font: "Consolas" })] }));
        }
        break;
      case "table":
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: block.rows.map(
              (row) =>
                new TableRow({
                  tableHeader: row.header,
                  children: row.cells.map(
                    (cell) =>
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: row.header
                              ? runs(cell.map((i) => (i.kind === "text" ? { ...i, bold: true } : i)))
                              : runs(cell),
                          }),
                        ],
                      })
                  ),
                })
            ),
          }),
          new Paragraph({ text: "" })
        );
        break;
      case "rule":
        children.push(new Paragraph({ text: "", border: { bottom: { style: "single", size: 6, color: "999999", space: 1 } } }));
        break;
    }
  }

  const footerLines = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 16 })],
    }),
  ];
  if (options.aiAssistedFooter) {
    footerLines.push(
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Drafted with AI assistance.", size: 16 })] })
    );
  }

  const listLevel = (format: (typeof LevelFormat)[keyof typeof LevelFormat], text: string) => ({
    level: 0,
    format,
    text,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720, hanging: 360 } } },
  });

  const author = options.authorName ?? "Styleprint";
  const document = new Document({
    creator: author,
    lastModifiedBy: author,
    title: doc.title,
    styles: {
      paragraphStyles: [
        {
          id: "Quote",
          name: "Quote",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { italics: true },
          paragraph: { indent: { left: 720, right: 720 } },
        },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [listLevel(LevelFormat.BULLET, "•")] },
        { reference: "numbers", levels: [listLevel(LevelFormat.DECIMAL, "%1.")] },
      ],
    },
    footnotes: Object.fromEntries(doc.footnotes.map((text, i) => [i + 1, { children: [new Paragraph({ text })] }])),
    sections: [{ children, footers: { default: new Footer({ children: footerLines }) } }],
  });

  return Packer.toBuffer(document);
}
