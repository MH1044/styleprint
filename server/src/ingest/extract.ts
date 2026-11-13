import path from "node:path";
import mammoth from "mammoth";
import { extractPdfText } from "./pdf.js";
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
    case ".pdf":
      return extractPdfText(buffer);
  }
}
