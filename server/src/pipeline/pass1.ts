import { chatCompletion } from "../ai/client.js";
import { renderPrompt } from "./prompts.js";
import type { ChatCompletionResult } from "@voicebox/shared";

export interface Pass1Input {
  paragraph: string;
  prev: string;
  next: string;
  avoidList: string[];
  retrySuffix?: string;
}

export async function runPass1(input: Pass1Input): Promise<ChatCompletionResult> {
  let prompt = renderPrompt("pass1-deai", {
    avoid_list: input.avoidList.join(", "),
    prev: input.prev || "(none)",
    next: input.next || "(none)",
    paragraph: input.paragraph,
  });
  if (input.retrySuffix) prompt += `\n\n${input.retrySuffix}`;

  return chatCompletion({
    tier: "publik-balanced",
    temperature: 0.7,
    prompt,
    mock: { kind: "pass1", paragraph: input.paragraph },
  });
}
