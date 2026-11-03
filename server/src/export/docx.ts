import { Document, Packer, Paragraph, TextRun, HeadingLevel, Footer, AlignmentType } from "docx";

export interface DocxExportOptions {
  title: string;
  bodyParagraphs: string[];
  authorName?: string;
  includeTitlePage?: boolean;
  aiAssistedFooter?: boolean;
}

export async function buildDocx(options: DocxExportOptions): Promise<Buffer> {
  const children: Paragraph[] = [];

  if (options.includeTitlePage) {
    children.push(
      new Paragraph({ text: options.title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
      new Paragraph({ text: "", pageBreakBefore: true })
    );
  }

  children.push(new Paragraph({ text: options.title, heading: HeadingLevel.HEADING_1 }));

  for (const paragraph of options.bodyParagraphs) {
    children.push(new Paragraph({ children: [new TextRun(paragraph)] }));
  }

  const footer = options.aiAssistedFooter
    ? new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "Drafted with AI assistance.", size: 16 })],
          }),
        ],
      })
    : undefined;

  const doc = new Document({
    creator: options.authorName ?? "Voicebox",
    title: options.title,
    sections: [
      {
        children,
        footers: footer ? { default: footer } : undefined,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
