import { Router } from "express";
import { getWallet, writeCredentialFile, clearUserKey, provision, resolveCredentials } from "../ai/index.js";
import { isMockMode } from "../env.js";
import { PublikPaymentError } from "@styleprint/shared";

export const walletRouter = Router();

/** Drives the first-run card: does the app already have a usable credential? */
walletRouter.get("/credential-status", (_req, res) => {
  if (isMockMode()) {
    res.json({ mock: true, hasCredentials: true, source: "mock" });
    return;
  }
  try {
    const creds = resolveCredentials();
    res.json({ mock: false, hasCredentials: true, source: creds.source });
  } catch {
    res.json({ mock: false, hasCredentials: false, source: "none" });
  }
});

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
  try {
    const credential = await provision();
    res.json({
      ok: true,
      claimUrl: credential.installClaimUrl,
      claimState: credential.installClaimState,
      costSentence: credential.installCostSentence,
      balanceMicros: credential.installBalanceMicros,
    });
  } catch (err) {
    res.status(502).json({ error: { message: err instanceof Error ? err.message : "provisioning failed" } });
  }
});
