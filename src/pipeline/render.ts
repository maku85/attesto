import type { Lang } from "../kb/schema.ts";
import type { Block, Line } from "./templates/layout.ts";

export function toMarkdown(blocks: Block[]): string {
  return blocks.map(markdownBlock).join("\n\n") + "\n";
}

function markdownBlock(block: Block): string {
  switch (block.kind) {
    case "title":
      return `# ${md(block.line)}`;
    case "subtitle":
      return `_${md(block.line)}_`;
    case "heading":
      return `## ${md(block.line)}`;
    case "photo":
      return `\\[${md(block.line)}\\]`;
    case "entry":
      return [`### ${md(block.title)}`, ...(block.meta ? [md(block.meta)] : [])].join("\n\n");
    case "details":
      return block.rows
        .map(({ label, line }) => `- **${escapeMarkdown(label)}:** ${md(line)}`)
        .join("\n");
    case "paragraph":
      return block.lines.map(md).join(" ");
    case "lines":
      return block.lines.map(md).join("\\\n");
    case "bullets":
      return block.lines.map((line) => `- ${md(line)}`).join("\n");
  }
}

const md = ({ text }: Line) => escapeMarkdown(text);

/** Text stays text: it can neither format the document nor add links or HTML to it. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_[\]<>|#~!&]/g, "\\$&")
    .replace(/^(?:[-+=]|\d+[.)])(?=\s|$)/, (marker) => `${marker.slice(0, -1)}\\${marker.at(-1)}`);
}

export function toHtml(blocks: Block[], lang: Lang): string {
  const title = blocks.find((block) => block.kind === "title" || block.kind === "heading");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title && "line" in title ? html(title.line) : ""}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${blocks.map(htmlBlock).join("\n")}
</main>
</body>
</html>
`;
}

function htmlBlock(block: Block): string {
  switch (block.kind) {
    case "title":
      return `<h1>${html(block.line)}</h1>`;
    case "subtitle":
      return `<p class="subtitle">${html(block.line)}</p>`;
    case "heading":
      return `<h2>${html(block.line)}</h2>`;
    case "photo":
      return `<div class="photo">${html(block.line)}</div>`;
    case "entry":
      return `<h3>${html(block.title)}</h3>${block.meta ? `<p class="meta">${html(block.meta)}</p>` : ""}`;
    case "details":
      return `<dl>${block.rows
        .map(({ label, line }) => `<dt>${escapeHtml(label)}</dt><dd>${html(line)}</dd>`)
        .join("")}</dl>`;
    case "paragraph":
      return `<p>${block.lines.map(html).join(" ")}</p>`;
    case "lines":
      return `<p class="lines">${block.lines.map(html).join("<br>")}</p>`;
    case "bullets":
      return `<ul>${block.lines.map((line) => `<li>${html(line)}</li>`).join("")}</ul>`;
  }
}

function html({ text }: Line): string {
  const escaped = escapeHtml(text);
  return /^https?:\/\/\S+$/.test(text) ? `<a href="${escaped}">${escaped}</a>` : escaped;
}

function escapeHtml(text: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

const STYLE = `
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: #1a1a1a; font: 11pt/1.5 system-ui, sans-serif; }
main { max-width: 48rem; margin: 0 auto; padding: 2rem 1rem; }
h1 { margin: 0; font-size: 1.8em; }
h2 { margin: 1.5em 0 .4em; border-bottom: 1px solid #bbb; font-size: 1.15em; }
h3 { margin: 1em 0 0; font-size: 1em; }
p { margin: .5em 0; }
ul { margin: .3em 0; padding-left: 1.2em; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: .1em 1em; margin: 1em 0; }
dt { color: #555; }
dd { margin: 0; overflow-wrap: anywhere; }
a { color: inherit; }
.lines { margin: 0 0 1.5em; }
.subtitle, .meta { margin: 0; color: #555; }
.photo { float: right; width: 3.5cm; height: 4.5cm; border: 1px dashed #888; color: #555;
  display: grid; place-items: center; }
h2, h3 { break-after: avoid; }
li { break-inside: avoid; }
@page { size: A4; margin: 1.8cm; }
@media print { main { max-width: none; padding: 0; } }
`;
