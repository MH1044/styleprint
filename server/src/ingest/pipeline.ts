import { extractText } from "./extract.js";
import { cleanSampleText } from "./clean.js";
import { splitIntoParagraphs, splitIntoSentences, wordCount } from "./split.js";
import { detectAiLikeSample, dedupeParagraphs, MIN_SAMPLE_WORDS } from "./analyze.js";
import type { Tag } from "@voicebox/shared";

export interface IngestChunkDraft {
  kind: "sentence" | "paragraph";
  text: string;
}

export interface IngestResult {
  title: string;
  tag: Tag;
  cleanedText: string;
  wordCount: number;
  paragraphCount: number;
  chunks: IngestChunkDraft[];
  flaggedAi: boolean;
  flagReason: string | null;
  tooShort: boolean;
}

export function ingestRawText(title: string, rawText: string, tag: Tag): IngestResult {
  const cleaned = cleanSampleText(rawText);
  const paragraphs = dedupeParagraphs(splitIntoParagraphs(cleaned));
  const cleanedText = paragraphs.join("\n\n");
  const words = wordCount(cleanedText);

  const chunks: IngestChunkDraft[] = [];
  for (const paragraph of paragraphs) {
    chunks.push({ kind: "paragraph", text: paragraph });
    for (const sentence of splitIntoSentences(paragraph)) {
      chunks.push({ kind: "sentence", text: sentence });
    }
  }

  const aiLikeness = detectAiLikeSample(paragraphs);

  return {
    title,
    tag,
    cleanedText,
    wordCount: words,
    paragraphCount: paragraphs.length,
    chunks,
    flaggedAi: aiLikeness.flagged,
    flagReason: aiLikeness.reason,
    tooShort: words < MIN_SAMPLE_WORDS,
  };
}

export async function ingestUpload(filename: string, buffer: Buffer, tag: Tag): Promise<IngestResult> {
  const raw = await extractText(filename, buffer);
  return ingestRawText(filename, raw, tag);
}
