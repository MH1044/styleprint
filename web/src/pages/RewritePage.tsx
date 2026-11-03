import { useState } from "react";
import type { PipelineRunResult } from "@voicebox/shared";
import { api, ApiError } from "../api/client.js";

function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(3)}`;
}

export default function RewritePage({
  profileId,
  onDocumentCreated,
  onRewritten,
}: {
  profileId: string;
  onDocumentCreated: (id: string) => void;
  onRewritten: () => void;
}) {
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [highFidelity, setHighFidelity] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topUpUrl, setTopUpUrl] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineRunResult | null>(null);

  async function runRewrite(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setRunning(true);
    setError(null);
    setTopUpUrl(null);
    setResult(null);
    try {
      const document = await api.createDocument(profileId, title || "Untitled document", draft);
      onDocumentCreated(document.id);
      const pipelineResult = await api.rewriteDocument(document.id, highFidelity);
      setResult(pipelineResult);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setError(e.message);
        setTopUpUrl(e.topUpUrl);
      } else {
        setError(e instanceof Error ? e.message : "rewrite failed");
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Paste an AI draft</h2>
        <p className="mt-1 text-sm text-stone-500">
          Pass 1 removes AI texture, pass 2 lands it in your voice using examples from your corpus.
        </p>
      </div>

      <form onSubmit={runRewrite} className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Document title"
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
          data-testid="document-title"
        />
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={12}
          placeholder="Paste your AI-generated draft here"
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
          data-testid="draft-textarea"
        />
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={highFidelity}
            onChange={(e) => setHighFidelity(e.target.checked)}
            data-testid="high-fidelity-toggle"
          />
          High fidelity (publik-smart, costs more)
        </label>
        <button
          type="submit"
          disabled={running}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          data-testid="run-rewrite"
        >
          {running ? "Rewriting…" : "Rewrite"}
        </button>
      </form>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
          {topUpUrl && (
            <a href={topUpUrl} target="_blank" rel="noreferrer" className="underline">
              Top up balance
            </a>
          )}
        </div>
      )}

      {result && (
        <div className="space-y-3 rounded-md border border-stone-200 bg-white p-4" data-testid="rewrite-result">
          <div className="flex items-center justify-between text-sm">
            <span>Voice match</span>
            <span>
              {result.voiceMatchBefore} → <strong>{result.voiceMatchAfter}</strong>
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>Charge</span>
            <span>{formatMicros(result.totalChargeMicros)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>Paragraphs</span>
            <span>
              {result.paragraphs.filter((p) => p.status === "done").length} done,{" "}
              {result.paragraphs.filter((p) => p.status === "needs_review").length} need review
            </span>
          </div>
          <button
            onClick={onRewritten}
            className="w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white"
            data-testid="go-to-wizard"
          >
            Review in wizard →
          </button>
        </div>
      )}
    </div>
  );
}
