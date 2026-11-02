import { chatCompletion } from "../ai/client.js";
import { renderPrompt } from "./prompts.js";
import { parsePass2Response, type ParsedPass2 } from "./parseTail.js";
import type { ModelTier, StyleTargets } from "@voicebox/shared";

export interface Pass2Input {
  paragraph: string;
  styleCard: string;
  targets: StyleTargets;
  retrievedExamples: string[];
  highFidelity?: boolean;
  retrySuffix?: string;
}

export interface Pass2Output extends ParsedPass2 {
  usage: Awaited<ReturnType<typeof chatCompletion>>["usage"];
  tier: ModelTier;
}

export async function runPass2(input: Pass2Input): Promise<Pass2Output> {
  let prompt = renderPrompt("pass2-voice", {
    style_card: input.styleCard,
    mean_len: String(input.targets.meanSentenceLen),
    std_len: String(input.targets.stdSentenceLen),
    contraction_rate: String(input.targets.contractionRate),
    dash_rate: String(input.targets.emDashRate),
    semi_rate: String(input.targets.semicolonRate),
    openers: input.targets.favoriteOpeners.join(", ") || "(none dominant)",
    avoid_list: input.targets.avoidList.join(", "),
    retrieved_examples: input.retrievedExamples.join("\n\n") || "(no close examples found)",
    paragraph: input.paragraph,
  });
  if (input.retrySuffix) prompt += `\n\n${input.retrySuffix}`;

  const tier: ModelTier = input.highFidelity ? "publik-smart" : "publik-balanced";
  const result = await chatCompletion({
    tier,
    temperature: 0.5,
    prompt,
    mock: { kind: "pass2", paragraph: input.paragraph },
  });

  const parsed = parsePass2Response(result.text);
  return { ...parsed, usage: result.usage, tier };
}
