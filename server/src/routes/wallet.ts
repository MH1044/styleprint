import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getWallet, writeCredentialFile, clearUserKey, provisionInstallKey } from "../ai/index.js";
import { PublikPaymentError } from "@voicebox/shared";

export const walletRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_TOKEN_PATH = path.resolve(__dirname, "../../../publik-app-token.txt");

walletRouter.get("/", async (_req, res) => {
  try {
    const wallet = await getWallet();
    res.json(wallet);
  } catch (err) {
    if (err instanceof PublikPaymentError) {
      res.status(402).json({ error: { message: err.message, top_up_url: err.topUpUrl } });
      return;
    }
    res.status(502).json({ error: { message: err instanceof Error ? err.message : "wallet request failed" } });
  }
});

walletRouter.post("/own-key", (req, res) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  const baseUrl = typeof req.body?.baseUrl === "string" ? req.body.baseUrl.trim() : undefined;
  if (!apiKey) {
    res.status(400).json({ error: { message: "apiKey is required" } });
    return;
  }
  writeCredentialFile({ userKey: apiKey, userBaseUrl: baseUrl });
  res.json({ ok: true });
});

walletRouter.delete("/own-key", (_req, res) => {
  clearUserKey();
  res.json({ ok: true });
});

walletRouter.post("/provision", async (_req, res) => {
  let appToken: string;
  try {
    appToken = fs.readFileSync(APP_TOKEN_PATH, "utf8").trim();
  } catch {
    res.status(500).json({ error: { message: "publik-app-token.txt not found" } });
    return;
  }
  try {
    const key = await provisionInstallKey(appToken);
    writeCredentialFile({ installKey: key });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: { message: err instanceof Error ? err.message : "provisioning failed" } });
  }
});
