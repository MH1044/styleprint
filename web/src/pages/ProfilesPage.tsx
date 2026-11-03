import { useEffect, useState } from "react";
import type { Profile } from "@voicebox/shared";
import { api } from "../api/client.js";

export default function ProfilesPage({ onSelect }: { onSelect: (id: string) => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api
      .listProfiles()
      .then(setProfiles)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, []);

  async function createProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const profile = await api.createProfile(name.trim());
      setName("");
      setProfiles((prev) => [profile, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not create profile");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Your voices</h2>
        <p className="mt-1 text-sm text-stone-500">
          Each profile holds its own writing samples, style card and retrieval index. Pick one to work in, or start a
          new one.
        </p>
      </div>

      <form onSubmit={createProfile} className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Work email, Personal blog"
          className="flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm"
          data-testid="new-profile-name"
        />
        <button
          type="submit"
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white"
          data-testid="create-profile"
        >
          New profile
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-stone-400">Loading…</p>}

      <ul className="divide-y divide-stone-200 rounded-md border border-stone-200 bg-white">
        {profiles.map((p) => (
          <li key={p.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-stone-500">{p.styleCard ? "style card ready" : "no style card yet"}</p>
            </div>
            <button
              onClick={() => onSelect(p.id)}
              className="rounded-md border border-stone-300 px-3 py-1 text-sm hover:bg-stone-50"
              data-testid={`select-profile-${p.id}`}
            >
              Open
            </button>
          </li>
        ))}
        {!loading && profiles.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-stone-400">No profiles yet. Create one above.</li>
        )}
      </ul>
    </div>
  );
}
