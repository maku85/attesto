export const TEMPLATES = ["classic", "modern"] as const;
export type Template = (typeof TEMPLATES)[number];

/** Both share one HTML structure in reading order, so that text extraction gives the same result. */
const BASE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #1a1a1a; line-height: 1.45;
  print-color-adjust: exact; -webkit-print-color-adjust: exact; }
main { max-width: 48rem; margin: 0 auto; padding: 2rem 1rem; }
h1, h2, h3, p { margin: 0; }
ul { margin: .25em 0 0; padding-left: 1.15em; }
li { margin: .15em 0; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: .1em 1em; margin: 0; }
dt { color: #555; }
dd { margin: 0; overflow-wrap: anywhere; }
a { color: inherit; text-decoration: none; }
.entry { margin-top: .9em; }
.entry:first-child { margin-top: 0; }
.entry h3 { font-size: 1em; }
.meta, .subtitle { color: #555; }
.photo { float: right; width: 3.5cm; height: 4.5cm; border: 1px dashed #888; color: #555;
  display: grid; place-items: center; }
.letter header p, .letter section p { margin-bottom: .9em; }
.letter header p.lines, .letter section p.lines { margin-bottom: 1.6em; }
h2, h3, .meta:not(:last-child) { break-after: avoid; }
li, .entry, section:not(:has(.entry)) { break-inside: avoid; }
@page { size: A4; margin: 1.7cm 1.8cm; }
@media print { main { max-width: none; padding: 0; } }
`;

const CLASSIC = `
body { font: 10.5pt/1.45 "Helvetica Neue", Arial, "Liberation Sans", sans-serif; }
h1 { font-size: 1.9em; }
.subtitle { font-size: 1.1em; margin-bottom: .9em; }
h2 { font-size: 1.1em; border-bottom: 1px solid #999; padding-bottom: .1em; margin-bottom: .5em; }
section { margin-top: 1.3em; }
`;

const MODERN = `
body { font: 10.5pt/1.5 "Avenir Next", "Segoe UI", "Noto Sans", Arial, sans-serif; color: #222; }
main { border-top: .7cm solid #4a7ab8; padding-top: 1.2rem; }
h1 { font-size: 2.4em; line-height: 1.1; letter-spacing: .04em; text-transform: uppercase; }
.subtitle { font-size: 1.15em; font-weight: 600; color: #2f5f9e; margin: .2em 0 1em; }
h2 { color: #2f5f9e; font-size: 1.05em; letter-spacing: .06em; text-transform: uppercase; }
section { margin-top: 1.4em; }
h2 { border-top: 2px solid #4a7ab8; padding-top: .6em; }
/* The heading floats beside its text. A grid row would not break between entries when printed, and a
   positioned heading would come after its section in the text of the PDF. Isolation keeps the painting
   order, which is the text order, within each section. */
.cv section { padding-left: 4.9cm; isolation: isolate; }
.cv section > div { border-top: 2px solid #4a7ab8; padding-top: .6em; }
.cv h2 { float: left; width: 4.9cm; margin-left: -4.9cm; text-align: right; padding-right: .7cm;
  break-after: auto; }
.letter h2 { text-transform: none; letter-spacing: 0; font-size: 1.2em; margin-bottom: .8em; }
.entry h3 { color: #222; }
@media print { main { padding-top: .8cm; } }
@media screen and (max-width: 40rem) {
  .cv section { padding-left: 0; }
  .cv h2 { float: none; width: auto; margin-left: 0; text-align: left; margin-bottom: .4em; }
  .cv section > div { border-top: 0; padding-top: 0; }
}
`;

export const STYLE: Record<Template, string> = {
  classic: BASE + CLASSIC,
  modern: BASE + MODERN,
};
