import { Router } from "express";
import { getDb } from "../db/client.js";
import { createProfile, listProfiles, getProfile } from "../db/repo.js";

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
