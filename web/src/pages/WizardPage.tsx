import { useCallback, useEffect, useState } from "react";
import type { ParagraphRecord } from "@voicebox/shared";
import { api } from "../api/client.js";
import { wordDiff } from "../lib/diff.js";

type Mode = "idle" | "steer" | "edit" | "blend";

export default function WizardPage({ documentId, onDone }: { documentId: string; onDone: () => void }) {
  const [queue, setQueue] = useState<ParagraphRecord[] | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [steerText, setSteerText] = useState("");
  const [editText, setEditText] = useState("");
  const [blendRatio, setBlendRatio] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.wizardSummary>> | null>(null);

  const refresh = useCallback(() => {
    api.getQueue(documentId).then((r) => setQueue(r.queue));
  }, [documentId]);

  useEffect(refresh, [refresh]);

  const current = queue && queue.length > 0 ? queue[0] : null;

  useEffect(() => {
    setMode("idle");
    setSteerText("");
    setEditText(current?.final ?? current?.pass2 ?? "");
    setBlendRatio(0.5);
  }, [current?.id]);

  const advance = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.getQueue(documentId);
      setQueue(r.queue);
      if (r.queue.length === 0) {
        const s = await api.wizardSummary(documentId);
        setSummary(s);
      }
    } finally {
      setBusy(false);
      setMode("idle");
    }
  }, [documentId]);

  const doKeep = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    await api.keep(documentId, current.id);
    await advance();
  }, [current, documentId, busy, advance]);

  const doRevert = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    await api.revert(documentId, current.id);
    await advance();
  }, [current, documentId, busy, advance]);

  const doRetry = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    await api.retry(documentId, current.id, steerText);
    await advance();
  }, [current, documentId, busy, steerText, advance]);

  const doEdit = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    await api.editParagraph(documentId, current.id, editText);
    await advance();
  }, [current, documentId, busy, editText, advance]);

  const doBlend = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    await api.blend(documentId, current.id, blendRatio);
    await advance();
  }, [current, documentId, busy, blendRatio, advance]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!current) return;
      if (mode === "idle") {
        if (e.key === "1") doKeep();
        else if (e.key === "2") doRevert();
        else if (e.key === "3") setMode("steer");
        else if (e.key === "4") setMode("edit");
        else if (e.key === "5") setMode("blend");
      } else if (e.key === "Escape") {
        setMode("idle");
      } else if (e.key === "Enter" && mode === "steer" && !e.shiftKey) {
        e.preventDefault();
        doRetry();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, mode, doKeep, doRevert, doRetry]);

  if (summary) {
    return (
      <div className="space-y-4 rounded-md border border-stone-200 bg-white p-6" data-testid="wizard-summary">
        <h2 className="text-xl font-semibold">Review complete</h2>
        <ul className="space-y-1 text-sm">
          <li>Kept: {summary.counts.keep ?? 0}</li>
          <li>Reverted: {summary.counts.revert ?? 0}</li>
          <li>Edited: {summary.counts.edit ?? 0}</li>
          <li>Retried: {summary.counts.retry ?? 0}</li>
          <li>Blended: {summary.counts.blend ?? 0}</li>
          <li>Final voice match: {summary.voiceMatch ?? "—"}</li>
        </ul>
        <button
          onClick={onDone}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white"
          data-testid="open-in-editor"
        >
          Open in editor
        </button>
      </div>
    );
  }

  if (!queue) return <p className="text-sm text-stone-400">Loading…</p>;

  if (!current) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-stone-500">Nothing left to review.</p>
        <button
          onClick={async () => setSummary(await api.wizardSummary(documentId))}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white"
        >
          Finish
        </button>
      </div>
    );
  }

  const rewritten = current.final ?? current.pass2 ?? current.original;
  const diff = wordDiff(current.original, rewritten);
  const unsure = current.unsureJson?.[0];

  return (
    <div className="space-y-4" data-testid="wizard-card">
      <div className="flex items-center justify-between text-sm text-stone-500">
        <span>{queue.length} left to review</span>
        <span>Keys: 1 keep · 2 revert · 3 try again · 4 edit · 5 blend</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-stone-200 bg-stone-50 p-4">
          <h3 className="mb-1 text-xs font-semibold uppercase text-stone-400">Original</h3>
          <p className="text-sm text-stone-500">{current.original}</p>
        </div>
        <div className="rounded-md border border-stone-200 bg-white p-4">
          <h3 className="mb-1 text-xs font-semibold uppercase text-stone-400">Rewritten</h3>
          <p className="text-sm" data-testid="rewritten-text">
            {diff.map((token, i) => (
              <span key={i} className={token.changed ? "bg-amber-200" : undefined}>
                {token.text}
              </span>
            ))}
          </p>
        </div>
      </div>

      {unsure && (
        <p className="text-sm italic text-stone-500">
          Model's note: {unsure.reason || "not sure this landed right"}
        </p>
      )}
      {current.status === "needs_review" && (
        <p className="text-sm font-medium text-amber-700">Flagged: needs review (a check failed twice).</p>
      )}

      {mode === "steer" && (
        <div className="rounded-md border border-stone-300 bg-white p-3">
          <input
            autoFocus
            value={steerText}
            onChange={(e) => setSteerText(e.target.value)}
            placeholder="e.g. more blunt, this is a joke, keep the list"
            className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
            data-testid="steer-input"
          />
          <button onClick={doRetry} className="mt-2 rounded-md bg-stone-900 px-3 py-1 text-sm text-white">
            Try again
          </button>
        </div>
      )}

      {mode === "edit" && (
        <div className="rounded-md border border-stone-300 bg-white p-3">
          <textarea
            autoFocus
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
            data-testid="edit-textarea"
          />
          <button onClick={doEdit} className="mt-2 rounded-md bg-stone-900 px-3 py-1 text-sm text-white">
            Save edit
          </button>
        </div>
      )}

      {mode === "blend" && (
        <div className="rounded-md border border-stone-300 bg-white p-3">
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={blendRatio}
            onChange={(e) => setBlendRatio(Number(e.target.value))}
            className="w-full"
            data-testid="blend-slider"
          />
          <div className="flex justify-between text-xs text-stone-500">
            <span>Original</span>
            <span>Rewritten</span>
          </div>
          <button onClick={doBlend} className="mt-2 rounded-md bg-stone-900 px-3 py-1 text-sm text-white">
            Apply blend
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        <button onClick={doKeep} disabled={busy} className="rounded-md border border-stone-300 px-3 py-1" data-testid="action-keep">
          1 Keep
        </button>
        <button onClick={doRevert} disabled={busy} className="rounded-md border border-stone-300 px-3 py-1" data-testid="action-revert">
          2 Revert
        </button>
        <button onClick={() => setMode("steer")} disabled={busy} className="rounded-md border border-stone-300 px-3 py-1" data-testid="action-retry">
          3 Try again
        </button>
        <button onClick={() => setMode("edit")} disabled={busy} className="rounded-md border border-stone-300 px-3 py-1" data-testid="action-edit">
          4 Edit
        </button>
        <button onClick={() => setMode("blend")} disabled={busy} className="rounded-md border border-stone-300 px-3 py-1" data-testid="action-blend">
          5 Blend
        </button>
      </div>
    </div>
  );
}
