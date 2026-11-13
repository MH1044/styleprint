import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { plainInlines, type ExportDoc } from "./model.js";

export interface PdfExportOptions {
  pageSize?: "letter" | "a4";
  fontSize?: number;
}

const PAGE_SIZES: Record<"letter" | "a4", [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

const MARGIN = 72;

const SUBSTITUTES: Record<string, string> = { "→": "->", "←": "<-", "⇒": "=>", "≥": ">=", "≤": "<=", " ": " " };

/**
 * The standard PDF fonts only cover WinAnsi (roughly Latin-1 plus curly
 * quotes and dashes). Anything else, emoji or arrows say, is swapped for a
 * close ASCII equivalent or "?" rather than failing the whole export.
 */
function encodable(font: PDFFont, cache: Map<string, boolean>, text: string): string {
  let out = "";
  for (const ch of text.replace(/\t/g, "    ")) {
    const replacement = SUBSTITUTES[ch];
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }
    let ok = cache.get(ch);
    if (ok === undefined) {
      try {
        font.encodeText(ch);
        ok = true;
      } catch {
        ok = false;
      }
      cache.set(ch, ok);
    }
    out += ok ? ch : "?";
  }
  return out;
}

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

interface Line {
  text: string;
  font: PDFFont;
  size: number;
  indent: number;
  gapAfter: number;
}

/**
 * Server-side PDF export from the editor's document (the browser's own
 * print-to-PDF is the other route). Plain text per block: headings in bold,
 * list items with their bullet or number, quotes in italics, footnote
 * references as [n] with the notes collected at the end. No network.
 */
export async function buildPdf(doc: ExportDoc, options: PdfExportOptions = {}): Promise<Buffer> {
  const [width, height] = PAGE_SIZES[options.pageSize ?? "letter"];
  const fontSize = options.fontSize ?? 12;
  const lineHeight = fontSize * 1.4;
  const maxWidth = width - MARGIN * 2;

  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const caches = new Map<PDFFont, Map<string, boolean>>();
  const safe = (font: PDFFont, text: string) => {
    if (!caches.has(font)) caches.set(font, new Map());
    return encodable(font, caches.get(font)!, text);
  };

  const lines: Line[] = [];
  const add = (text: string, font: PDFFont, size: number, indent = 0, gapAfter = 0, hanging = indent) => {
    const wrapped = wrapLine(safe(font, text), font, size, maxWidth - Math.max(indent, hanging));
    wrapped.forEach((t, i) => {
      lines.push({ text: t, font, size, indent: i === 0 ? indent : hanging, gapAfter: i === wrapped.length - 1 ? gapAfter : 0 });
    });
    if (wrapped.length === 0) lines.push({ text: "", font, size, indent, gapAfter });
  };

  add(doc.title, bold, fontSize + 4, 0, lineHeight * 0.5);
  for (const block of doc.blocks) {
    switch (block.kind) {
      case "heading":
        add(plainInlines(block.inlines), bold, fontSize + Math.max(0, 3 - block.level), 0, lineHeight * 0.3);
        break;
      case "paragraph":
        add(plainInlines(block.inlines), regular, fontSize, 0, lineHeight * 0.6);
        break;
      case "list":
        block.items.forEach((item, i) => {
          add(`${block.ordered ? `${i + 1}.` : "•"} ${plainInlines(item)}`, regular, fontSize, 12, i === block.items.length - 1 ? lineHeight * 0.6 : 0, 26);
        });
        break;
      case "quote":
        for (const p of block.paragraphs) add(plainInlines(p), italic, fontSize, 24, lineHeight * 0.6);
        break;
      case "code":
        for (const codeLine of block.text.split("\n")) add(codeLine, mono, fontSize - 2, 12);
        lines[lines.length - 1].gapAfter = lineHeight * 0.6;
        break;
      case "table":
        block.rows.forEach((row, i) => {
          add(row.cells.map(plainInlines).join("  |  "), row.header ? bold : regular, fontSize, 0, i === block.rows.length - 1 ? lineHeight * 0.6 : 0);
        });
        break;
      case "rule":
        add("", regular, fontSize, 0, lineHeight * 0.3);
        break;
    }
  }
  if (doc.footnotes.length > 0) {
    add("Notes", bold, fontSize, 0, lineHeight * 0.2);
    doc.footnotes.forEach((f, i) => add(`${i + 1}. ${f}`, regular, fontSize - 2, 0, 0, 14));
  }

  let page: PDFPage = pdf.addPage([width, height]);
  const pages: PDFPage[] = [page];
  let y = height - MARGIN;
  for (const line of lines) {
    const step = line.size * 1.4;
    if (y < MARGIN + step) {
      page = pdf.addPage([width, height]);
      pages.push(page);
      y = height - MARGIN;
    }
    if (line.text) page.drawText(line.text, { x: MARGIN + line.indent, y, size: line.size, font: line.font, color: rgb(0, 0, 0) });
    y -= step + line.gapAfter;
  }

  const footerTitle = safe(regular, doc.title);
  pages.forEach((p, i) => {
    p.drawText(`${footerTitle} — page ${i + 1} of ${pages.length}`, {
      x: MARGIN,
      y: MARGIN / 2,
      size: 9,
      font: regular,
      color: rgb(0.4, 0.4, 0.4),
    });
  });

  return Buffer.from(await pdf.save());
}
