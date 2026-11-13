import { Router } from "express";
import { getDb } from "../db/client.js";
import { getDocument, getProfile } from "../db/repo.js";
import { currentEditorDoc, saveVersion } from "../document/service.js";
import { buildExportDoc } from "../export/model.js";
import { buildDocx } from "../export/docx.js";
import { buildPdf } from "../export/pdf.js";
import { buildMarkdown, buildPlainText, buildRichTextHtml } from "../export/text.js";

export const exportRouter = Router();

const VERSION_LABELS: Record<string, string> = {
  docx: "Exported as .docx",
  pdf: "Exported as .pdf",
  md: "Exported as .md",
  txt: "Exported as .txt",
  html: "Copied as rich text",
};

/** A Content-Disposition for the file, safe on every platform, without a doubled extension. */
function attachment(name: string, ext: string): string {
  const base = name.endsWith(`.${ext}`) ? name.slice(0, -(ext.length + 1)) : name;
  const safe = base.replace(/[\\/:*?"<>|\r\n]+/g, " ").trim() || "document";
  return `attachment; filename="${safe.replace(/[^\x20-\x7e]/g, "_")}.${ext}"; filename*=UTF-8''${encodeURIComponent(safe)}.${ext}`;
}

/**
 * Every export is rendered from the editor's document (what the user sees
 * and edited), never from the raw rewrite, and saves a named version so later
 * exports can be compared with earlier ones (Stage 6, "Snapshot").
 */
exportRouter.get("/:documentId/:format", async (req, res) => {
  const db = getDb();
  const document = getDocument(db, req.params.documentId);
  if (!document) {
    res.status(404).json({ error: { message: "document not found" } });
    return;
  }
  const format = req.params.format;
  if (!VERSION_LABELS[format]) {
    res.status(400).json({ error: { message: `unsupported export format: ${format}` } });
    return;
  }

  const profile = getProfile(db, document.profileId);
  const editorDoc = currentEditorDoc(db, document);
  const doc = buildExportDoc(document.title, editorDoc);
  const filename = typeof req.query.filename === "string" && req.query.filename.trim() ? req.query.filename.trim() : document.title;

  try {
    let body: Buffer | string;
    let contentType: string;
    switch (format) {
      case "docx":
        body = await buildDocx(doc, {
          authorName: profile?.name,
          includeTitlePage: req.query.titlePage === "1",
          aiAssistedFooter: req.query.aiFooter === "1",
        });
        contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        break;
      case "pdf":
        body = await buildPdf(doc, { pageSize: req.query.pageSize === "a4" ? "a4" : "letter" });
        contentType = "application/pdf";
        break;
      case "md":
        body = buildMarkdown(doc);
        contentType = "text/markdown; charset=utf-8";
        break;
      case "txt":
        body = buildPlainText(doc);
        contentType = "text/plain; charset=utf-8";
        break;
      default:
        body = buildRichTextHtml(doc);
        contentType = "text/html; charset=utf-8";
    }
    saveVersion(db, document.id, VERSION_LABELS[format], editorDoc, { onlyIfChanged: true });
    // ?download=1 comes from a click in the app: a generic type makes every
    // webview (WKWebView on macOS included) save the file instead of showing
    // a PDF or text file in place of the app.
    res.setHeader("Content-Type", req.query.download === "1" ? "application/octet-stream" : contentType);
    if (format !== "html") res.setHeader("Content-Disposition", attachment(filename, format));
    res.send(body);
  } catch (err) {
    res.status(500).json({ error: { message: err instanceof Error ? err.message : "export failed" } });
  }
});
