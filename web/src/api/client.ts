import type {
  Profile,
  Sample,
  VoiceDocument,
  ParagraphRecord,
  PipelineRunResult,
  Tag,
} from "@voicebox/shared";

const BASE = "/api";

export class ApiError extends Error {
  status: number;
  topUpUrl: string | null;
  constructor(status: number, message: string, topUpUrl: string | null = null) {
    super(message);
    this.status = status;
    this.topUpUrl = topUpUrl;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `request failed: ${response.status}`;
    let topUpUrl: string | null = null;
    try {
      const body = await response.json();
      message = body?.error?.message ?? message;
      topUpUrl = body?.error?.top_up_url ?? null;
    } catch {
      // ignore unparsable error body
    }
    throw new ApiError(response.status, message, topUpUrl);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  listProfiles: () => request<Profile[]>("/profiles"),
  createProfile: (name: string) => request<Profile>("/profiles", { method: "POST", body: JSON.stringify({ name }) }),
  getProfile: (id: string) => request<Profile>(`/profiles/${id}`),
  getMeter: (id: string) =>
    request<{ totalWords: number; sampleCount: number; band: string; minSampleWords: number }>(
      `/profiles/${id}/meter`
    ),
  buildStyle: (id: string) =>
    request<{ styleJson: unknown; styleCard: string; embeddings: { source: string; count: number } }>(
      `/profiles/${id}/build-style`,
      { method: "POST" }
    ),

  listSamples: (profileId: string) => request<Sample[]>(`/ingest/${profileId}/samples`),
  uploadFile: async (profileId: string, file: File, tag: Tag) => {
    const form = new FormData();
    form.append("file", file);
    form.append("tag", tag);
    const response = await fetch(`${BASE}/ingest/${profileId}/upload`, { method: "POST", body: form });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(response.status, body?.error?.message ?? "upload failed");
    }
    return response.json();
  },
  pasteText: (profileId: string, title: string, text: string, tag: Tag) =>
    request(`/ingest/${profileId}/paste`, { method: "POST", body: JSON.stringify({ title, text, tag }) }),

  createDocument: (profileId: string, title: string, draftText: string) =>
    request<VoiceDocument>("/documents", { method: "POST", body: JSON.stringify({ profileId, title, draftText }) }),
  getDocument: (id: string) => request<{ document: VoiceDocument; paragraphs: ParagraphRecord[] }>(`/documents/${id}`),
  rewriteDocument: (id: string, highFidelity: boolean) =>
    request<PipelineRunResult>(`/documents/${id}/rewrite`, {
      method: "POST",
      body: JSON.stringify({ highFidelity }),
    }),
  selectionRewrite: (id: string, text: string, action: string) =>
    request<{ text: string; chargeMicros: number }>(`/documents/${id}/selection-rewrite`, {
      method: "POST",
      body: JSON.stringify({ text, action }),
    }),
  voiceCheck: (id: string, text: string) =>
    request<{ score: number; furthest: { label: string; current: number; target: number; diff: number }[] }>(
      `/documents/${id}/voice-check`,
      { method: "POST", body: JSON.stringify({ text }) }
    ),
  saveEditor: (id: string, editorJson: unknown, voiceMatch: number | null) =>
    request(`/documents/${id}/editor`, { method: "PUT", body: JSON.stringify({ editorJson, voiceMatch }) }),

  getQueue: (documentId: string) => request<{ queue: ParagraphRecord[]; total: number }>(`/wizard/${documentId}/queue`),
  keep: (documentId: string, paragraphId: string) =>
    request(`/wizard/${documentId}/paragraphs/${paragraphId}/keep`, { method: "POST" }),
  revert: (documentId: string, paragraphId: string) =>
    request<{ final: string }>(`/wizard/${documentId}/paragraphs/${paragraphId}/revert`, { method: "POST" }),
  editParagraph: (documentId: string, paragraphId: string, text: string) =>
    request<{ final: string }>(`/wizard/${documentId}/paragraphs/${paragraphId}/edit`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  blend: (documentId: string, paragraphId: string, ratio: number) =>
    request<{ final: string }>(`/wizard/${documentId}/paragraphs/${paragraphId}/blend`, {
      method: "POST",
      body: JSON.stringify({ ratio }),
    }),
  retry: (documentId: string, paragraphId: string, steer: string) =>
    request<{ final: string; confidence: number; chargeMicros: number }>(
      `/wizard/${documentId}/paragraphs/${paragraphId}/retry`,
      { method: "POST", body: JSON.stringify({ steer }) }
    ),
  wizardSummary: (documentId: string) =>
    request<{
      counts: Record<string, number>;
      totalDecisions: number;
      voiceMatch: number | null;
      remaining: number;
    }>(`/wizard/${documentId}/summary`),

  exportUrl: (documentId: string, format: string, params: Record<string, string> = {}) => {
    const query = new URLSearchParams(params).toString();
    return `${BASE}/export/${documentId}/${format}${query ? `?${query}` : ""}`;
  },

  getWallet: () =>
    request<{
      balanceMicros: number | null;
      weeklyUsageMicros: number | null;
      weeklyBudgetMicros: number | null;
      resetAt: string | null;
      source: string;
    }>("/wallet"),
  setOwnKey: (apiKey: string, baseUrl?: string) =>
    request("/wallet/own-key", { method: "POST", body: JSON.stringify({ apiKey, baseUrl }) }),
  clearOwnKey: () => request("/wallet/own-key", { method: "DELETE" }),
};
