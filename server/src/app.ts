import express, { type Express } from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { profilesRouter } from "./routes/profiles.js";
import { ingestRouter } from "./routes/ingest.js";
import { documentsRouter } from "./routes/documents.js";
import { wizardRouter } from "./routes/wizard.js";
import { exportRouter } from "./routes/export.js";
import { walletRouter } from "./routes/wallet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolves the built web frontend to serve as static files. Used by the
 * desktop (Tauri) build, which has no separate Vite dev server to point
 * at — the native window loads this same Express server. Tries the
 * source-tree layout first (../../web/dist from server/src), then a
 * packaged layout (./web next to the server bundle).
 */
function resolveWebDistDir(): string | null {
  const override = process.env.WEB_DIST_DIR;
  const candidates = [override, path.resolve(__dirname, "../../web/dist"), path.resolve(__dirname, "web")].filter(
    (p): p is string => Boolean(p)
  );
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

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

  const webDistDir = resolveWebDistDir();
  if (webDistDir) {
    app.use(express.static(webDistDir));
    // SPA fallback: any non-API, non-file route serves index.html.
    app.get(/^\/(?!api|health).*/, (_req, res) => {
      res.sendFile(path.join(webDistDir, "index.html"));
    });
  }

  return app;
}
