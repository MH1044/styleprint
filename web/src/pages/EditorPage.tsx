import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, useEditorState, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import type { DocNode, VersionSummary, VoiceDocument } from "@styleprint/shared";
import { api } from "../api/client.js";
import { ProvenanceExtension } from "../editor/provenance.js";
import { Footnote } from "../editor/footnote.js";
import { docText } from "../editor/docText.js";
import { wordDiff, type DiffToken } from "../lib/diff.js";

const SELECTION_ACTIONS: { action: string; label: string }[] = [
  { action: "rewrite-voice", label: "Rewrite in my voice" },
  { action: "make-shorter", label: "Make shorter" },
  { action: "make-plainer", label: "Make it plainer" },
  { action: "undo-ai", label: "Undo AI changes here" },
];

const AUTOSAVE_MS = 2000;

interface FootnoteEntry {
  pos: number;
  content: string;
}

function footnotesOf(editor: Editor): FootnoteEntry[] {
  const notes: FootnoteEntry[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "footnote") notes.push({ pos, content: String(node.attrs.content ?? "") });
  });
  return notes;
}

function Diff({ tokens }: { tokens: DiffToken[] }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {tokens.map((t, i) => (
        <span key={i} className={t.changed ? "rounded bg-amber-100" : undefined}>
          {t.text}
        </span>
      ))}
    </p>
  );
}

export default function EditorPage({
  documentId,
  notice,
  onDismissNotice,
}: {
  documentId: string;
  notice?: string | null;
  onDismissNotice?: () => void;
}) {
  const [document, setDocument] = useState<VoiceDocument | null>(null);
  const [heatView, setHeatView] = useState(false);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [voiceCheck, setVoiceCheck] = useState<Awaited<ReturnType<typeof api.voiceCheck>> | null>(null);
  const [footnoteDraft, setFootnoteDraft] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [versionLabel, setVersionLabel] = useState("");
  const [compare, setCompare] = useState<{ label: string; then: DiffToken[]; now: DiffToken[] } | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState({
    filename: "",
    pageSize: "letter",
    titlePage: false,
    aiFooter: false,
  });

  const editorRef = useRef<Editor | null>(null);
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveNow = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const editor = editorRef.current;
    if (editor && loaded.current) await api.saveEditor(documentId, editor.getJSON(), null);
  }, [documentId]);

  /** Saves now if an autosave is pending, so exports and versions see the latest text. */
  const flush = useCallback(async () => {
    if (saveTimer.current) await saveNow();
  }, [saveNow]);

  const extensions = useMemo(
    () => [StarterKit, Table.configure({ resizable: false }), TableRow, TableHeader, TableCell, ProvenanceExtension, Footnote],
    []
  );

  const editor = useEditor({
    extensions,
    content: "<p>Loading…</p>",
    onUpdate: () => {
      if (!loaded.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveNow().catch(() => {}), AUTOSAVE_MS);
    },
  });

  const live = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? { words: editor.getText().trim().split(/\s+/).filter(Boolean).length, footnotes: footnotesOf(editor) }
        : { words: 0, footnotes: [] as FootnoteEntry[] },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  const refreshVersions = useCallback(() => {
    api.listVersions(documentId).then(setVersions).catch(() => {});
  }, [documentId]);

  useEffect(() => {
    if (!editor) return;
    editorRef.current = editor;
    loaded.current = false;
    let cancelled = false;
    Promise.all([api.getDocument(documentId), api.getEditor(documentId)]).then(([{ document }, { editorJson }]) => {
      if (cancelled) return;
      setDocument(document);
      editor.commands.setContent(editorJson, { emitUpdate: false });
      loaded.current = true;
    });
    refreshVersions();
    return () => {
      cancelled = true;
      // Leaving the editor mid-autosave still saves.
      if (saveTimer.current) saveNow().catch(() => {});
    };
  }, [editor, documentId, refreshVersions, saveNow]);

  // The desktop app saves exports to the Downloads folder and reports where.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onDownloaded = (e: Event) => {
      setDownloaded((e as CustomEvent<{ path: string }>).detail.path);
      clearTimeout(timer);
      timer = setTimeout(() => setDownloaded(null), 8000);
    };
    window.addEventListener("styleprint:downloaded", onDownloaded);
    return () => {
      window.removeEventListener("styleprint:downloaded", onDownloaded);
      clearTimeout(timer);
    };
  }, []);

  async function applySelectionAction(action: string) {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    setSelectionBusy(true);
    try {
      const result = await api.selectionRewrite(documentId, selectedText, action);
      editor.chain().focus().insertContentAt({ from, to }, result.text).run();
    } finally {
      setSelectionBusy(false);
    }
  }

  async function runVoiceCheck() {
    if (!editor) return;
    setVoiceCheck(await api.voiceCheck(documentId, editor.getText()));
  }

  function insertFootnote() {
    if (!editor || !footnoteDraft?.trim()) return;
    editor.chain().focus().insertFootnote(footnoteDraft.trim()).run();
    setFootnoteDraft(null);
  }

  function updateFootnote(pos: number, content: string) {
    editor
      ?.chain()
      .command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, { content });
        return true;
      })
      .run();
  }

  function removeFootnote(pos: number) {
    editor?.chain().focus().deleteRange({ from: pos, to: pos + 1 }).run();
  }

  async function saveNamedVersion() {
    await flush();
    await api.saveVersion(documentId, versionLabel.trim() || "Saved version");
    setVersionLabel("");
    refreshVersions();
  }

  async function compareWith(version: VersionSummary) {
    if (!editor) return;
    await flush();
    const full = await api.getVersion(documentId, version.id);
    const then = docText(full.editorJson as DocNode);
    const now = docText(editor.getJSON() as DocNode);
    setCompare({ label: version.label, then: wordDiff(now, then), now: wordDiff(then, now) });
  }

  async function restore(version: VersionSummary) {
    if (!editor) return;
    await flush();
    const { editorJson } = await api.restoreVersion(documentId, version.id);
    editor.commands.setContent(editorJson, { emitUpdate: false });
    setCompare(null);
    refreshVersions();
  }

  async function openVersions() {
    await flush();
    refreshVersions();
    setVersionsOpen((open) => !open);
  }

  async function openExport() {
    await flush();
    setExportOpen(true);
  }

  async function download(url: string) {
    await flush();
    window.location.assign(`${url}${url.includes("?") ? "&" : "?"}download=1`);
    setTimeout(refreshVersions, 1500);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{document?.title ?? "Document"}</h2>
        <div className="flex gap-2 text-sm">
          <button
            onClick={() => setHeatView((v) => !v)}
            className="rounded-md border border-stone-300 px-3 py-1"
            data-testid="heat-view-toggle"
          >
            {heatView ? "Hide" : "Show"} heat view
          </button>
          <button onClick={runVoiceCheck} className="rounded-md border border-stone-300 px-3 py-1" data-testid="voice-check">
            Voice check
          </button>
          <button onClick={openVersions} className="rounded-md border border-stone-300 px-3 py-1" data-testid="versions-toggle">
            Versions
          </button>
          <button onClick={openExport} className="rounded-md bg-stone-900 px-3 py-1 text-white" data-testid="open-export">
            Export
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm" data-testid="editor-notice">
          <span>{notice}</span>
          <button onClick={onDismissNotice} className="text-stone-500 underline">
            Dismiss
          </button>
        </div>
      )}
      {downloaded && (
        <div className="rounded-md border border-stone-200 bg-white px-4 py-2 text-sm" data-testid="download-notice">
          Saved to <code>{downloaded}</code>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-sm text-stone-500">
        <span data-testid="word-count">{live.words} words</span>
        {voiceCheck && (
          <span data-testid="voice-check-score">
            · voice match {voiceCheck.score}
            {voiceCheck.furthest[0] && ` · furthest: ${voiceCheck.furthest[0].label}`}
          </span>
        )}
        {heatView && (
          <span className="flex gap-2 text-xs">
            · <span className="rounded bg-amber-50 px-1">rewritten</span>
            <span className="rounded bg-sky-50 px-1">hand-edited</span>
            <span className="rounded bg-rose-50 px-1">reverted</span>
            <span className="px-1">original</span>
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {SELECTION_ACTIONS.map((a) => (
          <button
            key={a.action}
            disabled={selectionBusy}
            onClick={() => applySelectionAction(a.action)}
            className="rounded-md border border-stone-300 px-2 py-1 text-xs disabled:opacity-40"
            data-testid={`selection-${a.action}`}
          >
            {a.label}
          </button>
        ))}
        <button
          onClick={() => setFootnoteDraft("")}
          className="rounded-md border border-stone-300 px-2 py-1 text-xs"
          data-testid="add-footnote"
        >
          Add footnote
        </button>
      </div>

      {footnoteDraft !== null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            insertFootnote();
          }}
          className="flex gap-2 text-sm"
        >
          <input
            autoFocus
            value={footnoteDraft}
            onChange={(e) => setFootnoteDraft(e.target.value)}
            placeholder="Footnote text, inserted where the cursor was"
            className="flex-1 rounded-md border border-stone-300 px-2 py-1"
            data-testid="footnote-input"
          />
          <button type="submit" className="rounded-md bg-stone-900 px-3 py-1 text-white" data-testid="footnote-insert">
            Insert
          </button>
          <button type="button" onClick={() => setFootnoteDraft(null)} className="text-stone-500 underline">
            Cancel
          </button>
        </form>
      )}

      <div
        className={`max-w-none rounded-md border border-stone-200 bg-white p-4 leading-relaxed [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:mb-3 ${
          heatView
            ? "[&_[data-provenance=rewritten]]:bg-amber-50 [&_[data-provenance=hand-edited]]:bg-sky-50 [&_[data-provenance=reverted]]:bg-rose-50"
            : ""
        }`}
        data-testid="editor-content"
      >
        <EditorContent editor={editor} />
      </div>

      {live.footnotes.length > 0 && (
        <section className="space-y-2 rounded-md border border-stone-200 bg-white p-4 text-sm" data-testid="footnotes">
          <h3 className="font-medium">Notes</h3>
          <ol className="space-y-2">
            {live.footnotes.map((note, i) => (
              <li key={`${note.pos}:${note.content}`} className="flex items-center gap-2">
                <span className="w-6 text-right text-stone-500">{i + 1}.</span>
                <input
                  defaultValue={note.content}
                  onBlur={(e) => e.target.value !== note.content && updateFootnote(note.pos, e.target.value)}
                  className="flex-1 rounded-md border border-stone-300 px-2 py-1"
                  data-testid={`footnote-text-${i + 1}`}
                />
                <button onClick={() => removeFootnote(note.pos)} className="text-xs text-stone-500 underline">
                  Remove
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {versionsOpen && (
        <section className="space-y-3 rounded-md border border-stone-200 bg-white p-4 text-sm" data-testid="versions">
          <h3 className="font-medium">Versions</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveNamedVersion();
            }}
            className="flex gap-2"
          >
            <input
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              placeholder="Name this version"
              className="flex-1 rounded-md border border-stone-300 px-2 py-1"
              data-testid="version-label"
            />
            <button type="submit" className="rounded-md bg-stone-900 px-3 py-1 text-white" data-testid="save-version">
              Save version
            </button>
          </form>
          <ul className="divide-y divide-stone-100">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-2" data-testid="version-item">
                <span>
                  {v.label} <span className="text-xs text-stone-400">{new Date(v.createdAt).toLocaleString()}</span>
                </span>
                <span className="flex gap-2">
                  <button onClick={() => compareWith(v)} className="text-xs underline" data-testid="version-compare">
                    Compare
                  </button>
                  <button onClick={() => restore(v)} className="text-xs underline" data-testid="version-restore">
                    Restore
                  </button>
                </span>
              </li>
            ))}
            {versions.length === 0 && <li className="py-2 text-stone-400">No versions yet.</li>}
          </ul>
          {compare && (
            <div className="grid gap-4 border-t border-stone-100 pt-3 sm:grid-cols-2" data-testid="version-compare-view">
              <div>
                <h4 className="mb-1 text-xs font-medium uppercase text-stone-500">{compare.label}</h4>
                <Diff tokens={compare.then} />
              </div>
              <div>
                <h4 className="mb-1 text-xs font-medium uppercase text-stone-500">Now</h4>
                <Diff tokens={compare.now} />
              </div>
            </div>
          )}
        </section>
      )}

      {exportOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30" data-testid="export-dialog">
          <div className="w-full max-w-md space-y-3 rounded-md bg-white p-6">
            <h3 className="text-lg font-semibold">Export</h3>
            <input
              value={exportOptions.filename}
              onChange={(e) => setExportOptions((o) => ({ ...o, filename: e.target.value }))}
              placeholder={document?.title ?? "Filename"}
              className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
              data-testid="export-filename"
            />
            <select
              value={exportOptions.pageSize}
              onChange={(e) => setExportOptions((o) => ({ ...o, pageSize: e.target.value }))}
              className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
            >
              <option value="letter">Letter</option>
              <option value="a4">A4</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={exportOptions.titlePage}
                onChange={(e) => setExportOptions((o) => ({ ...o, titlePage: e.target.checked }))}
              />
              Include title page
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={exportOptions.aiFooter}
                onChange={(e) => setExportOptions((o) => ({ ...o, aiFooter: e.target.checked }))}
              />
              Include "drafted with AI assistance" footer
            </label>

            <div className="flex flex-wrap gap-2 pt-2 text-sm">
              {["docx", "pdf", "md", "txt"].map((format) => {
                const href = api.exportUrl(documentId, format, {
                  titlePage: exportOptions.titlePage ? "1" : "0",
                  aiFooter: exportOptions.aiFooter ? "1" : "0",
                  pageSize: exportOptions.pageSize,
                  ...(exportOptions.filename.trim() ? { filename: exportOptions.filename.trim() } : {}),
                });
                return (
                  <a
                    key={format}
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      download(href);
                    }}
                    className="rounded-md border border-stone-300 px-3 py-1"
                    data-testid={`export-${format}`}
                  >
                    .{format}
                  </a>
                );
              })}
              <button
                onClick={async () => {
                  await flush();
                  const html = await fetch(api.exportUrl(documentId, "html")).then((r) => r.text());
                  try {
                    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }) })]);
                  } catch {
                    await navigator.clipboard.writeText(html);
                  }
                  refreshVersions();
                }}
                className="rounded-md border border-stone-300 px-3 py-1"
                data-testid="export-copy-rich-text"
              >
                Copy as rich text
              </button>
            </div>

            <button onClick={() => setExportOpen(false)} className="mt-2 text-sm text-stone-500 underline">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
