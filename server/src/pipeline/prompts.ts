import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, "../../../prompts");

export type PromptName = "pass1-deai" | "pass2-voice" | "style-card" | "postcheck-retry";

const PROMPT_FILES: Record<PromptName, string> = {
  "pass1-deai": "pass1-deai.v1.md",
  "pass2-voice": "pass2-voice.v1.md",
  "style-card": "style-card.v1.md",
  "postcheck-retry": "postcheck-retry.v1.md",
};

const cache = new Map<PromptName, string>();

/** Loads a prompt template from prompts/*.md at runtime. Never inlined. */
export function loadPromptTemplate(name: PromptName): string {
  const cached = cache.get(name);
  if (cached) return cached;
  const filePath = path.join(PROMPTS_DIR, PROMPT_FILES[name]);
  const raw = fs.readFileSync(filePath, "utf8");
  // Strip the leading `<!-- ... -->` version header line; keep everything else verbatim.
  const body = raw.replace(/^<!--.*?-->\s*\n/, "");
  cache.set(name, body);
  return body;
}

export function renderPrompt(name: PromptName, vars: Record<string, string>): string {
  const template = loadPromptTemplate(name);
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
}
