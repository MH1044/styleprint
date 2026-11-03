import { useEffect, useRef, useState } from "react";
import type { Sample, Tag } from "@voicebox/shared";
import { api } from "../api/client.js";

const TAGS: Tag[] = ["email", "essay", "blog", "report", "other"];

function bandLabel(band: string): string {
  if (band === "thin") return "thin — keep adding";
  if (band === "good") return "good";
  return "enough to train a LoRA";
}

export default function IngestPage({ profileId, onReady }: { profileId: string; onReady: () => void }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [meter, setMeter] = useState<{ totalWords: number; band: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [tag, setTag] = useState<Tag>("essay");
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [styleCard, setStyleCard] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function refresh() {
    api.listSamples(profileId).then(setSamples).catch(() => {});
    api.getMeter(profileId).then(setMeter).catch(() => {});
  }

  useEffect(refresh, [profileId]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await api.uploadFile(profileId, file, tag);
      }
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handlePaste(e: React.FormEvent) {
    e.preventDefault();
    if (!pasteText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.pasteText(profileId, pasteTitle || "Pasted text", pasteText, tag);
      setPasteText("");
      setPasteTitle("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save pasted text");
    } finally {
      setBusy(false);
    }
  }

  async function buildStyle() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.buildStyle(profileId);
      setStyleCard(result.styleCard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not build style profile");
    } finally {
      setBusy(false);
    }
  }

  const totalWords = meter?.totalWords ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold">Add your writing</h2>
        <p className="mt-1 text-sm text-stone-500">
          The corpus stays in <code>~/.voicebox/corpus/</code>. It is never uploaded in full — only short retrieved
          snippets are sent to the model during a rewrite.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          data-testid="consent-checkbox"
        />
        <span>This writing is mine, or I have the right to use it to build a style profile.</span>
      </label>

      <div className="rounded-md border border-stone-200 bg-white p-4">
        <div className="flex items-center justify-between text-sm">
          <span>{totalWords.toLocaleString()} words ingested</span>
          <span className="text-stone-500">{meter ? bandLabel(meter.band) : "…"}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
          <div
            className="h-full bg-stone-900 transition-all"
            style={{ width: `${Math.min(100, (totalWords / 8000) * 100)}%` }}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-stone-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-medium">Upload files</h3>
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value as Tag)}
            className="mb-2 w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
          >
            {TAGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            ref={fileInput}
            type="file"
            accept=".txt,.md,.docx,.pdf"
            multiple
            disabled={!consent || busy}
            onChange={(e) => handleFiles(e.target.files)}
            data-testid="file-input"
          />
        </div>

        <form onSubmit={handlePaste} className="rounded-md border border-stone-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-medium">Paste text</h3>
          <input
            value={pasteTitle}
            onChange={(e) => setPasteTitle(e.target.value)}
            placeholder="Title"
            className="mb-2 w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
          />
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={4}
            placeholder="Paste a sample of your own writing"
            className="mb-2 w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
            data-testid="paste-textarea"
          />
          <button
            type="submit"
            disabled={!consent || busy}
            className="rounded-md bg-stone-900 px-3 py-1 text-sm text-white disabled:opacity-40"
            data-testid="paste-submit"
          >
            Add sample
          </button>
        </form>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <h3 className="mb-2 text-sm font-medium">Samples ({samples.length})</h3>
        <ul className="divide-y divide-stone-200 rounded-md border border-stone-200 bg-white text-sm">
          {samples.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-4 py-2">
              <span>{s.title}</span>
              <span className="text-stone-500">
                {s.wordCount} words{s.flaggedAi ? " · looks AI-written" : ""}
              </span>
            </li>
          ))}
          {samples.length === 0 && <li className="px-4 py-6 text-center text-stone-400">No samples yet.</li>}
        </ul>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={buildStyle}
          disabled={samples.length === 0 || busy}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          data-testid="build-style"
        >
          Build style profile
        </button>
        <button
          onClick={onReady}
          disabled={!styleCard}
          className="rounded-md border border-stone-300 px-4 py-2 text-sm disabled:opacity-40"
          data-testid="go-to-rewrite"
        >
          Continue to rewrite →
        </button>
      </div>

      {styleCard && (
        <div className="rounded-md border border-stone-200 bg-stone-100 p-4 text-sm" data-testid="style-card">
          <h3 className="mb-1 font-medium">Style card</h3>
          <p className="whitespace-pre-wrap text-stone-700">{styleCard}</p>
        </div>
      )}
    </div>
  );
}
