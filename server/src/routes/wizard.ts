import { Router } from "express";
import { getDb } from "../db/client.js";
import {
  getDocument,
  getProfile,
  getParagraph,
  listParagraphsByDocument,
  updateParagraph,
  createDecision,
  listDecisionsByDocument,
  createSpend,
  listChunksByProfile,
} from "../db/repo.js";
import { runPass2 } from "../pipeline/pass2.js";
import { protectParagraph, stripKeepMarkers } from "../pipeline/protect.js";
import { nearestParagraphs } from "../embeddings/index.js";
import { blendParagraphs } from "../pipeline/blend.js";
import { computeStyleProfile, voiceMatchScore } from "../fingerprint/index.js";
import type { ParagraphRecord } from "@voicebox/shared";

export const wizardRouter = Router();

/**
 * Needs-review paragraphs first, then unsure spans sorted by confidence
 * ascending. A paragraph the user already resolved (any decision logged
 * against it) never reappears, even though its unsureJson is untouched —
 * the decision is what means "handled", not the model's own confidence.
 */
function queueOrder(paragraphs: ParagraphRecord[], decidedParagraphIds: Set<string>): ParagraphRecord[] {
  const undecided = paragraphs.filter((p) => !decidedParagraphIds.has(p.id));
  const needsReview = undecided.filter((p) => p.status === "needs_review");
  const rest = undecided
    .filter((p) => p.status !== "needs_review")
    .filter((p) => p.unsureJson && p.unsureJson.length > 0)
    .sort((a, b) => (a.confidence ?? 1) - (b.confidence ?? 1));
  return [...needsReview, ...rest];
}

function decidedIds(db: ReturnType<typeof getDb>, documentId: string): Set<string> {
  return new Set(listDecisionsByDocument(db, documentId).map((d) => d.paragraphId));
}

wizardRouter.get("/:documentId/queue", (req, res) => {
  const db = getDb();
  const document = getDocument(db, req.params.documentId);
  if (!document) {
    res.status(404).json({ error: { message: "document not found" } });
    return;
  }
  const paragraphs = listParagraphsByDocument(db, document.id);
  res.json({ queue: queueOrder(paragraphs, decidedIds(db, document.id)), total: paragraphs.length });
});

function loadParagraphOr404(db: ReturnType<typeof getDb>, id: string, res: import("express").Response) {
  const paragraph = getParagraph(db, id);
  if (!paragraph) {
    res.status(404).json({ error: { message: "paragraph not found" } });
    return null;
  }
  return paragraph;
}

wizardRouter.post("/:documentId/paragraphs/:paragraphId/keep", (req, res) => {
  const db = getDb();
  const paragraph = loadParagraphOr404(db, req.params.paragraphId, res);
  if (!paragraph) return;
  updateParagraph(db, paragraph.id, { status: "done" });
  createDecision(db, { documentId: req.params.documentId, paragraphId: paragraph.id, action: "keep", steer: null });
  res.json({ ok: true });
});

wizardRouter.post("/:documentId/paragraphs/:paragraphId/revert", (req, res) => {
  const db = getDb();
  const paragraph = loadParagraphOr404(db, req.params.paragraphId, res);
  if (!paragraph) return;
  updateParagraph(db, paragraph.id, { final: paragraph.original, status: "done" });
  createDecision(db, { documentId: req.params.documentId, paragraphId: paragraph.id, action: "revert", steer: null });
  res.json({ ok: true, final: paragraph.original });
});

wizardRouter.post("/:documentId/paragraphs/:paragraphId/edit", (req, res) => {
  const db = getDb();
  const paragraph = loadParagraphOr404(db, req.params.paragraphId, res);
  if (!paragraph) return;
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.trim()) {
    res.status(400).json({ error: { message: "text is required" } });
    return;
  }
  updateParagraph(db, paragraph.id, { final: text, status: "done" });
  createDecision(db, { documentId: req.params.documentId, paragraphId: paragraph.id, action: "edit", steer: null });
  res.json({ ok: true, final: text });
});

wizardRouter.post("/:documentId/paragraphs/:paragraphId/blend", (req, res) => {
  const db = getDb();
  const paragraph = loadParagraphOr404(db, req.params.paragraphId, res);
  if (!paragraph) return;
  const ratio = typeof req.body?.ratio === "number" ? req.body.ratio : 0.5;
  const rewritten = paragraph.final ?? paragraph.pass2 ?? paragraph.original;
  const blended = blendParagraphs(paragraph.original, rewritten, ratio);
  updateParagraph(db, paragraph.id, { final: blended, status: "done" });
  createDecision(db, {
    documentId: req.params.documentId,
    paragraphId: paragraph.id,
    action: "blend",
    steer: String(ratio),
  });
  res.json({ ok: true, final: blended });
});

wizardRouter.post("/:documentId/paragraphs/:paragraphId/retry", async (req, res) => {
  const db = getDb();
  const document = getDocument(db, req.params.documentId);
  if (!document) {
    res.status(404).json({ error: { message: "document not found" } });
    return;
  }
  const paragraph = loadParagraphOr404(db, req.params.paragraphId, res);
  if (!paragraph) return;
  const profile = getProfile(db, document.profileId);
  if (!profile || !profile.styleJson || !profile.styleCard) {
    res.status(400).json({ error: { message: "profile has no style card" } });
    return;
  }
  const steer = typeof req.body?.steer === "string" ? req.body.steer : "";

  const { protectedText } = protectParagraph(paragraph.original);
  const corpusChunks = listChunksByProfile(db, profile.id)
    .filter((c) => c.kind === "paragraph")
    .map((c) => ({ id: c.id, text: c.text, embedding: c.embedding }));
  const retrieved = await nearestParagraphs(stripKeepMarkers(paragraph.pass1 ?? protectedText), corpusChunks, 8);

  const retrySuffix = steer ? `The user wants this steer applied: "${steer}". Keep everything else the same.` : undefined;

  try {
    const pass2 = await runPass2({
      paragraph: paragraph.pass1 ?? protectedText,
      styleCard: profile.styleCard,
      targets: profile.styleJson.targets,
      retrievedExamples: retrieved.map((r) => r.text),
      retrySuffix,
    });

    const finalText = stripKeepMarkers(pass2.text);
    updateParagraph(db, paragraph.id, {
      pass2: finalText,
      final: finalText,
      confidence: pass2.tail.confidence,
      unsureJson: pass2.tail.unsure,
      status: "done",
    });
    createDecision(db, { documentId: document.id, paragraphId: paragraph.id, action: "retry", steer: steer || null });
    createSpend(db, {
      documentId: document.id,
      call: "wizard-retry",
      tier: pass2.tier,
      chargeMicros: pass2.usage.chargeMicros ?? 0,
      balanceAfterMicros: pass2.usage.balanceAfterMicros ?? null,
    });

    res.json({ ok: true, final: finalText, confidence: pass2.tail.confidence, chargeMicros: pass2.usage.chargeMicros });
  } catch (err) {
    res.status(502).json({ error: { message: err instanceof Error ? err.message : "retry failed" } });
  }
});

wizardRouter.get("/:documentId/summary", (req, res) => {
  const db = getDb();
  const document = getDocument(db, req.params.documentId);
  if (!document) {
    res.status(404).json({ error: { message: "document not found" } });
    return;
  }
  const profile = getProfile(db, document.profileId);
  const paragraphs = listParagraphsByDocument(db, document.id);
  const decisions = listDecisionsByDocument(db, document.id);

  const counts = { keep: 0, revert: 0, edit: 0, retry: 0, blend: 0 };
  for (const d of decisions) counts[d.action]++;

  const finalText = paragraphs.map((p) => p.final ?? p.pass2 ?? p.original).join("\n\n");
  const voiceMatch = profile?.styleJson ? voiceMatchScore(computeStyleProfile(finalText), profile.styleJson) : null;

  const decidedSet = new Set(decisions.map((d) => d.paragraphId));
  res.json({
    counts,
    totalDecisions: decisions.length,
    voiceMatch,
    remaining: queueOrder(paragraphs, decidedSet).length,
  });
});
