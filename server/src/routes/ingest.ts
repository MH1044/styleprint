import { Router, type Request, type Response } from "express";
import multer from "multer";
import { getDb } from "../db/client.js";
import { createSample, createChunk, listSamplesByProfile, getProfile } from "../db/repo.js";
import { ingestUpload, ingestRawText } from "../ingest/pipeline.js";
import type { Tag } from "@voicebox/shared";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export const ingestRouter = Router();

function isTag(value: unknown): value is Tag {
  return value === "email" || value === "essay" || value === "blog" || value === "report" || value === "other";
}

ingestRouter.get("/:profileId/samples", (req, res) => {
  const db = getDb();
  const profile = getProfile(db, req.params.profileId);
  if (!profile) {
    res.status(404).json({ error: { message: "profile not found" } });
    return;
  }
  res.json(listSamplesByProfile(db, profile.id));
});

function storeIngestResult(
  profileId: string,
  result: Awaited<ReturnType<typeof ingestUpload>>,
  sourcePath: string | null
) {
  const db = getDb();
  const sample = createSample(db, {
    profileId,
    title: result.title,
    sourcePath,
    tag: result.tag,
    text: result.cleanedText,
    wordCount: result.wordCount,
    flaggedAi: result.flaggedAi,
  });
  for (const chunk of result.chunks) {
    createChunk(db, { sampleId: sample.id, kind: chunk.kind, text: chunk.text, embedding: [] });
  }
  return { sample, flagReason: result.flagReason, tooShort: result.tooShort };
}

ingestRouter.post("/:profileId/upload", upload.single("file"), async (req: Request<{ profileId: string }>, res: Response) => {
  const profile = getProfile(getDb(), req.params.profileId);
  if (!profile) {
    res.status(404).json({ error: { message: "profile not found" } });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: { message: "file is required" } });
    return;
  }
  const tag = isTag(req.body?.tag) ? req.body.tag : "other";
  try {
    const result = await ingestUpload(req.file.originalname, req.file.buffer, tag);
    const stored = storeIngestResult(profile.id, result, req.file.originalname);
    res.status(201).json(stored);
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : "ingest failed" } });
  }
});

ingestRouter.post("/:profileId/paste", (req, res) => {
  const profile = getProfile(getDb(), req.params.profileId);
  if (!profile) {
    res.status(404).json({ error: { message: "profile not found" } });
    return;
  }
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title : "Pasted text";
  const tag = isTag(req.body?.tag) ? req.body.tag : "other";
  if (!text.trim()) {
    res.status(400).json({ error: { message: "text is required" } });
    return;
  }
  const result = ingestRawText(title, text, tag);
  const stored = storeIngestResult(profile.id, result, null);
  res.status(201).json(stored);
});
