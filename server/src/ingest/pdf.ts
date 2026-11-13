import type { PDFParse as PDFParseClass } from "pdf-parse";

/**
 * pdf-parse is loaded on first use, not at startup. Its renderer (pdfjs)
 * constructs a DOMMatrix the moment it loads, and in Node it borrows one from
 * the native @napi-rs/canvas package, which the desktop bundle doesn't ship:
 * text extraction never draws anything, and canvas would add a large native
 * binary per platform. A pure-JS DOMMatrix stands in instead.
 *
 * In Node, pdfjs runs its parser on a "fake worker" that it loads from a
 * pdf.worker.mjs file next to its own module, which the single-file desktop
 * bundle doesn't have. Importing the worker module first registers it on
 * globalThis.pdfjsWorker, and pdfjs uses that instead of looking for the file.
 *
 * Loading lazily also means a problem in the PDF stack can only fail a PDF
 * upload, never the server's startup.
 */
let pdfParse: Promise<typeof PDFParseClass> | null = null;

function loadPdfParse(): Promise<typeof PDFParseClass> {
  pdfParse ??= (async () => {
    const scope = globalThis as { DOMMatrix?: unknown };
    if (!scope.DOMMatrix) {
      const { default: CSSMatrix } = await import("@thednp/dommatrix");
      scope.DOMMatrix = CSSMatrix;
    }
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const { PDFParse } = await import("pdf-parse");
    return PDFParse;
  })();
  return pdfParse;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const PDFParse = await loadPdfParse();
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
