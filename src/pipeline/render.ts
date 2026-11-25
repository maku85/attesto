import type { Lang } from "../kb/schema.ts";
import type { Document } from "./document.ts";
import type { Block, Line } from "./templates/layout.ts";
import { STYLE, type Template } from "./templates/styles.ts";

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

export type HtmlOptions = { lang: Lang; type: Document["type"]; template?: Template };

export function toHtml(blocks: Block[], { lang, type, template = "classic" }: HtmlOptions): string {
  const title = blocks.find((block) => block.kind === "title" || block.kind === "heading");
  // No scripts, images or requests, whatever the text contains.
  const policy = "default-src 'none'; style-src 'unsafe-inline'";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title && "line" in title ? html(title.line) : ""}</title>
<style>${STYLE[template]}</style>
</head>
<body class="${type}">
<main>
${htmlSections(blocks)}
</main>
</body>
</html>
`;
}

/** Everything before the first heading is the header; every heading starts a section. */
function htmlSections(blocks: Block[]): string {
  const starts = blocks.flatMap(({ kind }, i) => (kind === "heading" ? [i] : []));
  const header = blocks.slice(0, starts[0] ?? blocks.length);
  const sections = starts.map((start, i) => {
    const [heading, ...content] = blocks.slice(start, starts[i + 1] ?? blocks.length);
    return `<section>\n${heading ? htmlBlock(heading) : ""}\n<div>\n${htmlContent(content)}\n</div>\n</section>`;
  });
  return [`<header>\n${htmlContent(header)}\n</header>`, ...sections].join("\n");
}

/** Keeps an entry together with the bullets that follow it. */
function htmlContent(blocks: Block[]): string {
  return blocks
    .map((block, i) => {
      if (block.kind === "entry") {
        const next = blocks[i + 1];
        const bullets = next?.kind === "bullets" ? `\n${htmlBlock(next)}` : "";
        return `<div class="entry">${htmlBlock(block)}${bullets}</div>`;
      }
      const inEntry = block.kind === "bullets" && blocks[i - 1]?.kind === "entry";
      return inEntry ? "" : htmlBlock(block);
    })
    .filter((part) => part !== "")
    .join("\n");
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
