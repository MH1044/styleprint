export function buildMarkdown(title: string, bodyParagraphs: string[]): string {
  return [`# ${title}`, "", ...bodyParagraphs].join("\n\n");
}

export function buildPlainText(title: string, bodyParagraphs: string[]): string {
  return [title, "", ...bodyParagraphs].join("\n\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Clipboard-ready rich text for pasting into email clients. */
export function buildRichTextHtml(title: string, bodyParagraphs: string[]): string {
  const body = bodyParagraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
  return `<h1>${escapeHtml(title)}</h1>\n${body}`;
}
