import type {
  PipelineParagraphResult,
  PipelineRunResult,
  StyleProfile,
  UnsureSpan,
} from "@styleprint/shared";
import { protectParagraph, stripKeepMarkers } from "./protect.js";
import { runPass1 } from "./pass1.js";
import { runPass2 } from "./pass2.js";
import { runLocalChecks, runFastTagCheck, buildRetrySuffix } from "./postcheck.js";
import { nearestParagraphs, type RetrievalCandidate } from "../embeddings/index.js";
import { computeStyleProfile, voiceMatchScore } from "../fingerprint/index.js";
import { segmentDraft } from "./segment.js";

export interface PipelineProfile {
  styleJson: StyleProfile;
  styleCard: string;
}

export interface RunPipelineOptions {
  documentId: string;
  draftText: string;
  profile: PipelineProfile;
  corpusParagraphs: RetrievalCandidate[];
  highFidelity?: boolean;
  retrievalK?: number;
}

async function processParagraph(
  idx: number,
  original: string,
  prev: string,
  next: string,
  profile: PipelineProfile,
  corpusParagraphs: RetrievalCandidate[],
  highFidelity: boolean,
  retrievalK: number
): Promise<{ result: PipelineParagraphResult; chargeMicros: number }> {
  const avoidList = profile.styleJson.targets.avoidList;
  const { protectedText, facts } = protectParagraph(original);
  let chargeMicros = 0;

  const pass1Result = await runPass1({ paragraph: protectedText, prev, next, avoidList });
  chargeMicros += pass1Result.usage.chargeMicros ?? 0;
  const pass1Text = pass1Result.text;

  const retrieved = await nearestParagraphs(stripKeepMarkers(pass1Text), corpusParagraphs, retrievalK);

  let pass2 = await runPass2({
    paragraph: pass1Text,
    styleCard: profile.styleCard,
    targets: profile.styleJson.targets,
    retrievedExamples: retrieved.map((r) => r.text),
    highFidelity,
  });
  chargeMicros += pass2.usage.chargeMicros ?? 0;

  let local = runLocalChecks(protectedText, facts, pass2.text, avoidList);
  const fastTag = await runFastTagCheck(stripKeepMarkers(pass2.text), facts);
  chargeMicros += fastTag.usage.chargeMicros ?? 0;

  let checksFailed = [...local.failures, ...(fastTag.factsOk ? [] : [fastTag.reason ?? "fast check failed"])];
  let needsReview = false;

  if (checksFailed.length > 0) {
    const retrySuffix = buildRetrySuffix(checksFailed.join("; "));
    pass2 = await runPass2({
      paragraph: pass1Text,
      styleCard: profile.styleCard,
      targets: profile.styleJson.targets,
      retrievedExamples: retrieved.map((r) => r.text),
      highFidelity,
      retrySuffix,
    });
    chargeMicros += pass2.usage.chargeMicros ?? 0;

    local = runLocalChecks(protectedText, facts, pass2.text, avoidList);
    if (!local.passed) {
      needsReview = true;
      checksFailed = local.failures;
    } else {
      checksFailed = [];
    }
  }

  const unsure: UnsureSpan[] = pass2.tail.unsure;

  const result: PipelineParagraphResult = {
    idx,
    original,
    pass1: stripKeepMarkers(pass1Text),
    pass2: stripKeepMarkers(pass2.text),
    final: stripKeepMarkers(pass2.text),
    confidence: pass2.tail.confidence,
    unsure,
    status: needsReview ? "needs_review" : "done",
    checksFailed,
  };

  return { result, chargeMicros };
}

export async function runPipeline(options: RunPipelineOptions): Promise<PipelineRunResult> {
  const paragraphs = segmentDraft(options.draftText);
  const retrievalK = options.retrievalK ?? 8;
  const highFidelity = options.highFidelity ?? false;

  const results: PipelineParagraphResult[] = [];
  let totalChargeMicros = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const prev = i > 0 ? paragraphs[i - 1] : "";
    const next = i < paragraphs.length - 1 ? paragraphs[i + 1] : "";
    const { result, chargeMicros } = await processParagraph(
      i,
      paragraphs[i],
      prev,
      next,
      options.profile,
      options.corpusParagraphs,
      highFidelity,
      retrievalK
    );
    results.push(result);
    totalChargeMicros += chargeMicros;
  }

  const beforeProfile = computeStyleProfile(options.draftText);
  const afterText = results.map((r) => r.final).join("\n\n");
  const afterProfile = computeStyleProfile(afterText || options.draftText);

  return {
    documentId: options.documentId,
    paragraphs: results,
    voiceMatchBefore: voiceMatchScore(beforeProfile, options.profile.styleJson),
    voiceMatchAfter: voiceMatchScore(afterProfile, options.profile.styleJson),
    totalChargeMicros,
  };
}
