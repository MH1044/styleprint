import { Router } from "express";
import { getDb } from "../db/client.js";
import {
  createDocument,
  getDocument,
  getProfile,
  listChunksByProfile,
  listParagraphsByDocument,
  createParagraph,
  updateParagraph,
  updateDocumentEditorJson,
  createSpend,
} from "../db/repo.js";
import { runPipeline } from "../pipeline/run.js";
import type { ModelTier } from "@voicebox/shared";

export const documentsRouter = Router();

documentsRouter.post("/", (req, res) => {
  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  const draftText = typeof req.body?.draftText === "string" ? req.body.draftText : "";
  const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title : "Untitled document";

  const db = getDb();
  const profile = getProfile(db, profileId);
  if (!profile) {
    res.status(404).json({ error: { message: "profile not found" } });
    return;
  }
  if (!draftText.trim()) {
    res.status(400).json({ error: { message: "draftText is required" } });
    return;
  }

  const document = createDocument(db, { profileId, title, draftText });
  res.status(201).json(document);
});

documentsRouter.get("/:id", (req, res) => {
  const db = getDb();
  const document = getDocument(db, req.params.id);
  if (!document) {
    res.status(404).json({ error: { message: "document not found" } });
    return;
  }
  const paragraphs = listParagraphsByDocument(db, document.id);
  res.json({ document, paragraphs });
});

documentsRouter.post("/:id/rewrite", async (req, res) => {
  const db = getDb();
  const document = getDocument(db, req.params.id);
  if (!document) {
    res.status(404).json({ error: { message: "document not found" } });
    return;
  }
  const profile = getProfile(db, document.profileId);
  if (!profile || !profile.styleJson || !profile.styleCard) {
    res.status(400).json({ error: { message: "build the profile's style card before rewriting" } });
    return;
  }

  const highFidelity = req.body?.highFidelity === true;
  const corpusChunks = listChunksByProfile(db, profile.id)
    .filter((c) => c.kind === "paragraph")
    .map((c) => ({ id: c.id, text: c.text, embedding: c.embedding }));

  try {
    const result = await runPipeline({
      documentId: document.id,
      draftText: document.draftText,
      profile: { styleJson: profile.styleJson, styleCard: profile.styleCard },
      corpusParagraphs: corpusChunks,
      highFidelity,
    });

    for (const p of result.paragraphs) {
      const row = createParagraph(db, { documentId: document.id, idx: p.idx, original: p.original });
      updateParagraph(db, row.id, {
        pass1: p.pass1,
        pass2: p.pass2,
        final: p.final,
        confidence: p.confidence,
        unsureJson: p.unsure,
        status: p.status,
      });
    }

    const tier: ModelTier = highFidelity ? "publik-smart" : "publik-balanced";
    createSpend(db, {
      documentId: document.id,
      call: "rewrite",
      tier,
      chargeMicros: result.totalChargeMicros,
      balanceAfterMicros: null,
    });

    updateDocumentEditorJson(db, document.id, document.editorJson, result.voiceMatchAfter);

    res.json(result);
  } catch (err) {
    res.status(502).json({ error: { message: err instanceof Error ? err.message : "rewrite failed" } });
  }
});

documentsRouter.put("/:id/editor", (req, res) => {
  const db = getDb();
  const document = getDocument(db, req.params.id);
  if (!document) {
    res.status(404).json({ error: { message: "document not found" } });
    return;
  }
  const editorJson = req.body?.editorJson;
  const voiceMatch = typeof req.body?.voiceMatch === "number" ? req.body.voiceMatch : null;
  updateDocumentEditorJson(db, document.id, editorJson, voiceMatch);
  res.json({ ok: true });
});
