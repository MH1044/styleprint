import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { stripMarkdownHeadings } from "./split.js";

export type SupportedExt = ".txt" | ".md" | ".docx" | ".pdf";

export function supportedExt(filename: string): SupportedExt | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".txt" || ext === ".md" || ext === ".docx" || ext === ".pdf") return ext;
  return null;
}

/** Extracts raw text from an uploaded file buffer. No cleaning applied yet. */
export async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const ext = supportedExt(filename);
  if (!ext) throw new Error(`unsupported file type: ${filename}`);

  switch (ext) {
    case ".txt":
      return buffer.toString("utf8");
    case ".md":
      return stripMarkdownHeadings(buffer.toString("utf8"));
    case ".docx": {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case ".pdf": {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        // pdf-parse inserts "-- N of M --" page delimiters between pages;
        // those are parser output, not content the user wrote.
        return result.text.replace(/^\s*--\s*\d+\s*of\s*\d+\s*--\s*$/gim, "");
      } finally {
        await parser.destroy();
      }
    }
  }
}
