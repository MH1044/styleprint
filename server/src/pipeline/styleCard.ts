import type { ChatCompletionResult, StyleProfile } from "@voicebox/shared";
import { chatCompletion } from "../ai/client.js";
import { renderPrompt } from "./prompts.js";

function summariseStyleJson(profile: StyleProfile): string {
  return [
    `mean sentence length ${profile.sentenceLength.mean} words (std dev ${profile.sentenceLength.std})`,
    `mean paragraph length ${profile.paragraphLength.meanSentences} sentences / ${profile.paragraphLength.meanWords} words`,
    `contraction rate ${profile.contractionRate} per 100 words`,
    `em dashes ${profile.punctuation.emDashPer100Words} per 100 words, semicolons ${profile.punctuation.semicolonPer100Words} per 100 words`,
    `oxford comma: ${profile.punctuation.oxfordComma ? "yes" : "no"}`,
    `favourite openers: ${profile.targets.favoriteOpeners.join(", ") || "none dominant"}`,
    `type-token ratio ${profile.vocabulary.typeTokenRatio}`,
    `hedging ${profile.hedging.perHundredWords} per 100 words, intensifiers ${profile.hedging.intensifierPerHundredWords} per 100 words`,
  ].join("; ");
}

function pickSampleParagraphs(paragraphs: string[], limit = 20): string[] {
  if (paragraphs.length <= limit) return paragraphs;
  const shuffled = [...paragraphs];
  let seed = paragraphs.length * 7919;
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (seed * 48271) % 2147483647;
    const j = seed % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, limit);
}

export async function generateStyleCard(
  profile: StyleProfile,
  corpusParagraphs: string[]
): Promise<ChatCompletionResult> {
  const samples = pickSampleParagraphs(corpusParagraphs);
  const prompt = renderPrompt("style-card", {
    style_json_summary: summariseStyleJson(profile),
    samples: samples.join("\n\n"),
  });

  return chatCompletion({
    tier: "publik-balanced",
    temperature: 0,
    prompt,
    mock: { kind: "style-card" },
  });
}
