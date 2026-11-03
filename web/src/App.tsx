import { useEffect, useState } from "react";
import ProfilesPage from "./pages/ProfilesPage.js";
import IngestPage from "./pages/IngestPage.js";
import RewritePage from "./pages/RewritePage.js";
import WizardPage from "./pages/WizardPage.js";
import EditorPage from "./pages/EditorPage.js";
import WalletBadge from "./components/WalletBadge.js";
import FirstRunCard from "./components/FirstRunCard.js";

export type View = "profiles" | "ingest" | "rewrite" | "wizard" | "editor";

const STEPS: { key: View; label: string }[] = [
  { key: "profiles", label: "Profile" },
  { key: "ingest", label: "Ingest" },
  { key: "rewrite", label: "Rewrite" },
  { key: "wizard", label: "Wizard" },
  { key: "editor", label: "Editor" },
];

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore storage errors (private mode, etc.)
  }
}

export default function App() {
  const [view, setView] = useState<View>("profiles");
  const [profileId, setProfileId] = useState<string | null>(() => readStorage("voicebox.profileId"));
  const [documentId, setDocumentId] = useState<string | null>(() => readStorage("voicebox.documentId"));

  useEffect(() => writeStorage("voicebox.profileId", profileId), [profileId]);
  useEffect(() => writeStorage("voicebox.documentId", documentId), [documentId]);

  function selectProfile(id: string) {
    setProfileId(id);
    setView("ingest");
  }

  function goToRewrite() {
    setView("rewrite");
  }

  function onDocumentCreated(id: string) {
    setDocumentId(id);
  }

  function goToWizard() {
    setView("wizard");
  }

  function goToEditor() {
    setView("editor");
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-semibold tracking-tight">Voicebox</h1>
          <nav className="flex items-center gap-1 text-sm">
            {STEPS.map((step, i) => (
              <button
                key={step.key}
                disabled={step.key !== "profiles" && !profileId}
                onClick={() => setView(step.key)}
                className={`rounded-full px-3 py-1 transition ${
                  view === step.key
                    ? "bg-stone-900 text-white"
                    : "text-stone-500 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                }`}
                data-testid={`nav-${step.key}`}
              >
                {i + 1}. {step.label}
              </button>
            ))}
          </nav>
          <WalletBadge />
        </div>
      </header>

      <FirstRunCard />

      <main className="mx-auto max-w-4xl px-6 py-8">
        {view === "profiles" && <ProfilesPage onSelect={selectProfile} />}
        {view === "ingest" && profileId && <IngestPage profileId={profileId} onReady={goToRewrite} />}
        {view === "rewrite" && profileId && (
          <RewritePage profileId={profileId} onDocumentCreated={onDocumentCreated} onRewritten={goToWizard} />
        )}
        {view === "wizard" && documentId && <WizardPage documentId={documentId} onDone={goToEditor} />}
        {view === "editor" && documentId && <EditorPage documentId={documentId} />}
      </main>
    </div>
  );
}
