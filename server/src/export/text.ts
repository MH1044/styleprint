import { plainInlines, type ExportDoc, type Inline } from "./model.js";

function markdownInlines(inlines: Inline[]): string {
  return inlines
    .map((i) => {
      if (i.kind === "footnote") return `[^${i.n}]`;
      let text = i.text.replace(/\n/g, "  \n");
      if (i.code) text = `\`${text}\``;
      if (i.bold) text = `**${text}**`;
      if (i.italic) text = `*${text}*`;
      if (i.href) text = `[${text}](${i.href})`;
      return text;
    })
    .join("");
}

export function buildMarkdown(doc: ExportDoc): string {
  const parts = [`# ${doc.title}`];
  for (const block of doc.blocks) {
    switch (block.kind) {
      case "heading":
        parts.push(`${"#".repeat(Math.min(block.level, 6))} ${markdownInlines(block.inlines)}`);
        break;
      case "paragraph":
        parts.push(markdownInlines(block.inlines));
        break;
      case "list":
        parts.push(block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : "-"} ${markdownInlines(item)}`).join("\n"));
        break;
      case "quote":
        parts.push(block.paragraphs.map((p) => `> ${markdownInlines(p)}`).join("\n>\n"));
        break;
      case "code":
        parts.push(`\`\`\`\n${block.text}\n\`\`\``);
        break;
      case "table": {
        const rows = block.rows.map((r) => `| ${r.cells.map((c) => markdownInlines(c).replace(/\|/g, "\\|")).join(" | ")} |`);
        const width = block.rows[0]?.cells.length ?? 0;
        rows.splice(1, 0, `|${" --- |".repeat(width)}`);
        parts.push(rows.join("\n"));
        break;
      }
      case "rule":
        parts.push("---");
        break;
    }
  }
  if (doc.footnotes.length > 0) parts.push(doc.footnotes.map((f, i) => `[^${i + 1}]: ${f}`).join("\n"));
  return parts.join("\n\n");
}

export function buildPlainText(doc: ExportDoc): string {
  const parts = [doc.title];
  for (const block of doc.blocks) {
    switch (block.kind) {
      case "heading":
      case "paragraph":
        parts.push(plainInlines(block.inlines));
        break;
      case "list":
        parts.push(block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : "-"} ${plainInlines(item)}`).join("\n"));
        break;
      case "quote":
        parts.push(block.paragraphs.map((p) => `    ${plainInlines(p)}`).join("\n\n"));
        break;
      case "code":
        parts.push(block.text);
        break;
      case "table":
        parts.push(block.rows.map((r) => r.cells.map(plainInlines).join(" | ")).join("\n"));
        break;
      case "rule":
        parts.push("----");
        break;
    }
  }
  if (doc.footnotes.length > 0) parts.push(["Notes", ...doc.footnotes.map((f, i) => `[${i + 1}] ${f}`)].join("\n"));
  return parts.join("\n\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function htmlInlines(inlines: Inline[]): string {
  return inlines
    .map((i) => {
      if (i.kind === "footnote") return `<sup><a href="#fn-${i.n}" id="fnref-${i.n}">${i.n}</a></sup>`;
      let html = escapeHtml(i.text).replace(/\n/g, "<br>");
      if (i.code) html = `<code>${html}</code>`;
      if (i.bold) html = `<strong>${html}</strong>`;
      if (i.italic) html = `<em>${html}</em>`;
      if (i.href) html = `<a href="${escapeHtml(i.href)}">${html}</a>`;
      return html;
    })
    .join("");
}

/** Clipboard-ready rich text for pasting into email clients. */
export function buildRichTextHtml(doc: ExportDoc): string {
  const parts = [`<h1>${escapeHtml(doc.title)}</h1>`];
  for (const block of doc.blocks) {
    switch (block.kind) {
      case "heading": {
        const tag = `h${Math.min(block.level, 6)}`;
        parts.push(`<${tag}>${htmlInlines(block.inlines)}</${tag}>`);
        break;
      }
      case "paragraph":
        parts.push(`<p>${htmlInlines(block.inlines)}</p>`);
        break;
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        parts.push(`<${tag}>${block.items.map((item) => `<li>${htmlInlines(item)}</li>`).join("")}</${tag}>`);
        break;
      }
      case "quote":
        parts.push(`<blockquote>${block.paragraphs.map((p) => `<p>${htmlInlines(p)}</p>`).join("")}</blockquote>`);
        break;
      case "code":
        parts.push(`<pre><code>${escapeHtml(block.text)}</code></pre>`);
        break;
      case "table":
        parts.push(
          `<table>${block.rows
            .map((r) => `<tr>${r.cells.map((c) => (r.header ? `<th>${htmlInlines(c)}</th>` : `<td>${htmlInlines(c)}</td>`)).join("")}</tr>`)
            .join("")}</table>`
        );
        break;
      case "rule":
        parts.push("<hr>");
        break;
    }
  }
  if (doc.footnotes.length > 0) {
    parts.push(
      `<hr>\n<ol class="footnotes">${doc.footnotes
        .map((f, i) => `<li id="fn-${i + 1}">${escapeHtml(f)} <a href="#fnref-${i + 1}">↩</a></li>`)
        .join("")}</ol>`
    );
  }
  return parts.join("\n");
}
