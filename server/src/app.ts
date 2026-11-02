import express, { type Express } from "express";
import cors from "cors";
import { profilesRouter } from "./routes/profiles.js";
import { ingestRouter } from "./routes/ingest.js";
import { documentsRouter } from "./routes/documents.js";
import { wizardRouter } from "./routes/wizard.js";
import { exportRouter } from "./routes/export.js";
import { walletRouter } from "./routes/wallet.js";

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/profiles", profilesRouter);
  app.use("/api/ingest", ingestRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/wizard", wizardRouter);
  app.use("/api/export", exportRouter);
  app.use("/api/wallet", walletRouter);

  return app;
}
