import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import type { ParagraphRecord, VoiceDocument } from "@voicebox/shared";
import { api } from "../api/client.js";
import { ProvenanceExtension, type Provenance } from "../editor/provenance.js";

function provenanceOf(p: ParagraphRecord): Provenance {
  const final = p.final ?? p.pass2 ?? p.original;
  if (final === p.original) return "original";
  if (p.pass2 && final === p.pass2) return "rewritten";
  return "hand-edited";
}

function buildInitialHtml(paragraphs: ParagraphRecord[]): string {
  return paragraphs
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((p) => {
      const text = p.final ?? p.pass2 ?? p.original;
      const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<p data-provenance="${provenanceOf(p)}">${escaped}</p>`;
    })
    .join("\n");
}

const SELECTION_ACTIONS: { action: string; label: string }[] = [
  { action: "rewrite-voice", label: "Rewrite in my voice" },
  { action: "make-shorter", label: "Make shorter" },
  { action: "make-plainer", label: "Make it plainer" },
  { action: "undo-ai", label: "Undo AI changes here" },
];

export default function EditorPage({ documentId }: { documentId: string }) {
  const [document, setDocument] = useState<VoiceDocument | null>(null);
  const [paragraphs, setParagraphs] = useState<ParagraphRecord[]>([]);
  const [heatView, setHeatView] = useState(false);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [voiceCheck, setVoiceCheck] = useState<Awaited<ReturnType<typeof api.voiceCheck>> | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState({
    filename: "document",
    pageSize: "letter",
    titlePage: false,
    aiFooter: false,
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const extensions = useMemo(
    () => [StarterKit, Table.configure({ resizable: false }), TableRow, TableHeader, TableCell, ProvenanceExtension],
    []
  );

  const editor = useEditor({
    extensions,
    content: "<p>Loading…</p>",
    onUpdate: ({ editor }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        api.saveEditor(documentId, editor.getJSON(), null).catch(() => {});
      }, 2000);
    },
  });

  useEffect(() => {
    api.getDocument(documentId).then(({ document, paragraphs }) => {
      setDocument(document);
      setParagraphs(paragraphs);
      editor?.commands.setContent(buildInitialHtml(paragraphs));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, editor]);

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
    const text = editor.getText();
    const result = await api.voiceCheck(documentId, text);
    setVoiceCheck(result);
  }

  function wordCount(): number {
    return editor ? editor.getText().trim().split(/\s+/).filter(Boolean).length : 0;
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
          <button
            onClick={() => setExportOpen(true)}
            className="rounded-md bg-stone-900 px-3 py-1 text-white"
            data-testid="open-export"
          >
            Export
          </button>
        </div>
      </div>

      <div className="flex gap-2 text-sm text-stone-500">
        <span>{wordCount()} words</span>
        {voiceCheck && (
          <span data-testid="voice-check-score">
            · voice match {voiceCheck.score}
            {voiceCheck.furthest[0] && ` · furthest: ${voiceCheck.furthest[0].label}`}
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
      </div>

      <div
        className={`max-w-none space-y-3 rounded-md border border-stone-200 bg-white p-4 leading-relaxed [&_p]:mb-3 ${
          heatView ? "[&_[data-provenance=rewritten]]:bg-amber-50 [&_[data-provenance=hand-edited]]:bg-sky-50" : ""
        }`}
        data-testid="editor-content"
      >
        <EditorContent editor={editor} />
      </div>

      {exportOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30" data-testid="export-dialog">
          <div className="w-full max-w-md space-y-3 rounded-md bg-white p-6">
            <h3 className="text-lg font-semibold">Export</h3>
            <input
              value={exportOptions.filename}
              onChange={(e) => setExportOptions((o) => ({ ...o, filename: e.target.value }))}
              className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
              placeholder="Filename"
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
              {["docx", "pdf", "md", "txt"].map((format) => (
                <a
                  key={format}
                  href={api.exportUrl(documentId, format, {
                    titlePage: exportOptions.titlePage ? "1" : "0",
                    aiFooter: exportOptions.aiFooter ? "1" : "0",
                    pageSize: exportOptions.pageSize,
                  })}
                  className="rounded-md border border-stone-300 px-3 py-1"
                  data-testid={`export-${format}`}
                >
                  .{format}
                </a>
              ))}
              <button
                onClick={async () => {
                  const html = await fetch(api.exportUrl(documentId, "html")).then((r) => r.text());
                  try {
                    await navigator.clipboard.write([
                      new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }) }),
                    ]);
                  } catch {
                    await navigator.clipboard.writeText(html);
                  }
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
