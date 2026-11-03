import { useEffect, useState } from "react";
import { api } from "../api/client.js";

/**
 * Shown once, before any credential is configured: explains the two ways to
 * pay for AI calls (own key, or a free capped per-install key) and lets the
 * user pick one without leaving the app. Never shown in mock mode.
 */
export default function FirstRunCard() {
  const [status, setStatus] = useState<{ hasCredentials: boolean } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getCredentialStatus()
      .then(setStatus)
      .catch(() => setStatus({ hasCredentials: true })); // fail closed: don't nag if the check itself fails
  }, []);

  async function useOwnKey(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.setOwnKey(apiKey.trim(), baseUrl.trim() || undefined);
      setStatus({ hasCredentials: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save key");
    } finally {
      setBusy(false);
    }
  }

  async function provision() {
    setBusy(true);
    setError(null);
    try {
      await api.provisionInstallKey();
      setStatus({ hasCredentials: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "provisioning failed — use your own key instead");
    } finally {
      setBusy(false);
    }
  }

  if (!status || status.hasCredentials) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50" data-testid="first-run-card">
      <div className="mx-auto max-w-4xl px-6 py-4 text-sm">
        <p className="mb-2 font-medium text-amber-900">
          No publik key yet. Rewrites need one of the following before they'll run for real.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <form onSubmit={useOwnKey} className="space-y-2">
            <p className="text-amber-800">Use your own OpenAI-compatible key:</p>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-… or pk_live_…"
              className="w-full rounded-md border border-amber-300 px-2 py-1"
            />
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="Base URL (optional, default publik)"
              className="w-full rounded-md border border-amber-300 px-2 py-1"
            />
            <button disabled={busy} className="rounded-md bg-amber-900 px-3 py-1 text-white disabled:opacity-40">
              Save key
            </button>
          </form>
          <div className="space-y-2">
            <p className="text-amber-800">Or get $0.05 of free publik credit, no account needed yet:</p>
            <button
              onClick={provision}
              disabled={busy}
              className="rounded-md border border-amber-400 px-3 py-1 text-amber-900 disabled:opacity-40"
            >
              Set up free key
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-red-700">{error}</p>}
      </div>
    </div>
  );
}
