import { Router } from "express";
import { getDb } from "../db/client.js";
import { createProfile, listProfiles, getProfile, listSamplesByProfile, updateProfileStyle } from "../db/repo.js";
import { rebuiltCard } from "../learning/index.js";
import { computeStyleProfile } from "../fingerprint/index.js";
import { generateStyleCard } from "../pipeline/styleCard.js";
import { indexProfileEmbeddings } from "../embeddings/index.js";
import { splitIntoParagraphs } from "../ingest/split.js";
import { MIN_SAMPLE_WORDS } from "../ingest/analyze.js";

export const profilesRouter = Router();

profilesRouter.get("/", (_req, res) => {
  const db = getDb();
  res.json(listProfiles(db));
});

profilesRouter.post("/", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: { message: "name is required" } });
    return;
  }
  const db = getDb();
  res.status(201).json(createProfile(db, name));
});

profilesRouter.get("/:id", (req, res) => {
  const db = getDb();
  const profile = getProfile(db, req.params.id);
  if (!profile) {
    res.status(404).json({ error: { message: "profile not found" } });
    return;
  }
  res.json(profile);
});

function wordMeterBand(totalWords: number): "thin" | "good" | "lora-ready" {
  if (totalWords > 8000) return "lora-ready";
  if (totalWords >= 1500) return "good";
  return "thin";
}

profilesRouter.get("/:id/meter", (req, res) => {
  const db = getDb();
  const profile = getProfile(db, req.params.id);
  if (!profile) {
    res.status(404).json({ error: { message: "profile not found" } });
    return;
  }
  const samples = listSamplesByProfile(db, profile.id);
  const totalWords = samples.reduce((sum, s) => sum + s.wordCount, 0);
  res.json({
    totalWords,
    sampleCount: samples.length,
    band: wordMeterBand(totalWords),
    minSampleWords: MIN_SAMPLE_WORDS,
  });
});

profilesRouter.post("/:id/build-style", async (req, res) => {
  const db = getDb();
  const profile = getProfile(db, req.params.id);
  if (!profile) {
    res.status(404).json({ error: { message: "profile not found" } });
    return;
  }
  const samples = listSamplesByProfile(db, profile.id);
  if (samples.length === 0) {
    res.status(400).json({ error: { message: "add at least one writing sample first" } });
    return;
  }

  const corpusText = samples.map((s) => s.text).join("\n\n");
  const corpusParagraphs = samples.flatMap((s) => splitIntoParagraphs(s.text));
  const styleJson = computeStyleProfile(corpusText);

  try {
    const cardResult = await generateStyleCard(styleJson, corpusParagraphs);
    const styleCard = rebuiltCard(db, profile, cardResult.text);
    updateProfileStyle(db, profile.id, styleJson, styleCard);
    const indexResult = await indexProfileEmbeddings(db, profile.id);
    res.json({ styleJson, styleCard, embeddings: indexResult });
  } catch (err) {
    res.status(502).json({ error: { message: err instanceof Error ? err.message : "style card generation failed" } });
  }
});
