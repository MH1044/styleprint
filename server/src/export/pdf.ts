import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface PdfExportOptions {
  title: string;
  bodyParagraphs: string[];
  pageSize?: "letter" | "a4";
  fontSize?: number;
}

const PAGE_SIZES: Record<"letter" | "a4", [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

const MARGIN = 72;

function wrapLine(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Server-side PDF export fallback (the browser's own print-to-PDF is the
 * primary path from the editor). No network, no publik call.
 */
export async function buildPdf(options: PdfExportOptions): Promise<Buffer> {
  const [width, height] = PAGE_SIZES[options.pageSize ?? "letter"];
  const fontSize = options.fontSize ?? 12;
  const lineHeight = fontSize * 1.4;
  const maxWidth = width - MARGIN * 2;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const boldFont = await doc.embedFont(StandardFonts.TimesRomanBold);

  const lines: { text: string; bold?: boolean; heading?: boolean }[] = [];
  lines.push({ text: options.title, bold: true, heading: true });
  lines.push({ text: "" });
  for (const paragraph of options.bodyParagraphs) {
    for (const line of wrapLine(paragraph, font, fontSize, maxWidth)) {
      lines.push({ text: line });
    }
    lines.push({ text: "" });
  }

  let page: PDFPage = doc.addPage([width, height]);
  let y = height - MARGIN;
  let pageNum = 1;
  const pages: PDFPage[] = [page];

  for (const line of lines) {
    if (y < MARGIN + lineHeight) {
      page = doc.addPage([width, height]);
      pages.push(page);
      pageNum++;
      y = height - MARGIN;
    }
    if (line.text) {
      page.drawText(line.text, {
        x: MARGIN,
        y,
        size: line.heading ? fontSize + 4 : fontSize,
        font: line.bold ? boldFont : font,
        color: rgb(0, 0, 0),
      });
    }
    y -= line.heading ? lineHeight * 1.5 : lineHeight;
  }

  pages.forEach((p, i) => {
    p.drawText(`${options.title} — page ${i + 1} of ${pages.length}`, {
      x: MARGIN,
      y: MARGIN / 2,
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
