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
import { chatCompletion } from "../ai/client.js";
import { computeStyleProfile, voiceMatchScore } from "../fingerprint/index.js";
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

const SELECTION_INSTRUCTIONS: Record<string, string> = {
  "rewrite-voice": "Rewrite the following selection in the user's voice described above, keeping every fact exactly.",
  "make-shorter": "Make the following selection noticeably shorter without losing any fact, number or name.",
  "make-plainer": "Rewrite the following selection in plainer, simpler language, keeping every fact exactly.",
  "undo-ai": "Rewrite the following selection to remove AI-sounding phrasing (filler, hedging, stacked transitions), keeping every fact exactly.",
};

documentsRouter.post("/:id/selection-rewrite", async (req, res) => {
  const db = getDb();
  const document = getDocument(db, req.params.id);
  if (!document) {
    res.status(404).json({ error: { message: "document not found" } });
    return;
  }
  const profile = getProfile(db, document.profileId);
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  const action = typeof req.body?.action === "string" ? req.body.action : "rewrite-voice";
  if (!text.trim()) {
    res.status(400).json({ error: { message: "text is required" } });
    return;
  }
  const instruction = SELECTION_INSTRUCTIONS[action] ?? SELECTION_INSTRUCTIONS["rewrite-voice"];
  const styleCard = profile?.styleCard ?? "No style card yet; use plain, clear prose.";

  try {
    const result = await chatCompletion({
      tier: "publik-balanced",
      temperature: 0.5,
      prompt: `How the user writes:\n${styleCard}\n\n${instruction}\n\nSelection:\n${text}\n\nRespond with only the rewritten selection, no preamble.`,
      mock: { kind: "pass1", paragraph: text },
    });
    res.json({ text: result.text, chargeMicros: result.usage.chargeMicros ?? 0 });
  } catch (err) {
    res.status(502).json({ error: { message: err instanceof Error ? err.message : "selection rewrite failed" } });
  }
});

documentsRouter.post("/:id/voice-check", (req, res) => {
  const db = getDb();
  const document = getDocument(db, req.params.id);
  if (!document) {
    res.status(404).json({ error: { message: "document not found" } });
    return;
  }
  const profile = getProfile(db, document.profileId);
  if (!profile?.styleJson) {
    res.status(400).json({ error: { message: "profile has no style profile yet" } });
    return;
  }
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  const currentProfile = computeStyleProfile(text);
  const score = voiceMatchScore(currentProfile, profile.styleJson);

  const deltas = [
    { label: "sentence length std dev", current: currentProfile.sentenceLength.std, target: profile.styleJson.sentenceLength.std },
    { label: "contraction rate", current: currentProfile.contractionRate, target: profile.styleJson.contractionRate },
    { label: "em dash rate", current: currentProfile.punctuation.emDashPer100Words, target: profile.styleJson.punctuation.emDashPer100Words },
  ]
    .map((d) => ({ ...d, diff: Math.abs(d.current - d.target) }))
    .sort((a, b) => b.diff - a.diff);

  res.json({ score, furthest: deltas.slice(0, 3) });
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
