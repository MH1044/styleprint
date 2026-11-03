import { Router } from "express";
import { getDb } from "../db/client.js";
import { getDocument, getProfile, listParagraphsByDocument, createVersion } from "../db/repo.js";
import { buildDocx } from "../export/docx.js";
import { buildPdf } from "../export/pdf.js";
import { buildMarkdown, buildPlainText, buildRichTextHtml } from "../export/text.js";

export const exportRouter = Router();

function bodyParagraphsFor(documentId: string) {
  const db = getDb();
  const paragraphs = listParagraphsByDocument(db, documentId);
  return paragraphs
    .sort((a, b) => a.idx - b.idx)
    .map((p) => p.final ?? p.pass2 ?? p.original)
    .filter((p) => p.trim().length > 0);
}

exportRouter.get("/:documentId/:format", async (req, res) => {
  const db = getDb();
  const document = getDocument(db, req.params.documentId);
  if (!document) {
    res.status(404).json({ error: { message: "document not found" } });
    return;
  }
  const profile = getProfile(db, document.profileId);
  const bodyParagraphs = bodyParagraphsFor(document.id);
  const format = req.params.format;
  const includeTitlePage = req.query.titlePage === "1";
  const aiAssistedFooter = req.query.aiFooter === "1";
  const pageSize = req.query.pageSize === "a4" ? "a4" : "letter";

  try {
    switch (format) {
      case "docx": {
        const buffer = await buildDocx({
          title: document.title,
          bodyParagraphs,
          authorName: profile?.name,
          includeTitlePage,
          aiAssistedFooter,
        });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="${document.title}.docx"`);
        res.send(buffer);
        return;
      }
      case "pdf": {
        const buffer = await buildPdf({ title: document.title, bodyParagraphs, pageSize });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${document.title}.pdf"`);
        res.send(buffer);
        return;
      }
      case "md": {
        const text = buildMarkdown(document.title, bodyParagraphs);
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${document.title}.md"`);
        res.send(text);
        return;
      }
      case "txt": {
        const text = buildPlainText(document.title, bodyParagraphs);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${document.title}.txt"`);
        res.send(text);
        return;
      }
      case "html": {
        const html = buildRichTextHtml(document.title, bodyParagraphs);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(html);
        return;
      }
      default:
        res.status(400).json({ error: { message: `unsupported export format: ${format}` } });
    }
  } catch (err) {
    res.status(500).json({ error: { message: err instanceof Error ? err.message : "export failed" } });
  }
});

exportRouter.post("/:documentId/snapshot", (req, res) => {
  const db = getDb();
  const document = getDocument(db, req.params.documentId);
  if (!document) {
    res.status(404).json({ error: { message: "document not found" } });
    return;
  }
  const label = typeof req.body?.label === "string" && req.body.label.trim() ? req.body.label : "export";
  const version = createVersion(db, { documentId: document.id, label, editorJson: document.editorJson ?? {} });
  res.status(201).json(version);
});
