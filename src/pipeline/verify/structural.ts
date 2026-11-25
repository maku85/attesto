import type { Lang } from "../../kb/schema.ts";
import type { Source } from "../../kb/sources.ts";
import type { Claim, StructuralProblem } from "../document.ts";

/** Checks that need no understanding of the text. */
export function checkStructure(
  claim: Claim,
  slot: string,
  language: Lang,
  sources: Map<string, Source>,
): StructuralProblem[] {
  const problems: StructuralProblem[] = [];
  const sentences = countSentences(claim.text, language);
  if (sentences === 0) problems.push("empty");
  // A second sentence could hide behind the sources of the first.
  if (sentences > 1) problems.push("multiple-sentences");
  if (claim.sources.length === 0) problems.push("no-source");
  const cited = claim.sources.map((id) => sources.get(id));
  if (cited.includes(undefined)) problems.push("unknown-source");
  if (cited.some((source) => source && !inScope(source, slot))) {
    problems.push("out-of-scope-source");
  }
  return problems;
}

/** Keeps achievements with the employer or project they belong to. */
export function inScope(source: Source, slot: string): boolean {
  switch (slot) {
    case "letter-body":
      return true;
    case "summary":
      return source.type !== "statement";
    default:
      return source.ownerId === slot;
  }
}

function countSentences(text: string, language: Lang): number {
  const segments = new Intl.Segmenter(language, { granularity: "sentence" }).segment(text.trim());
  return [...segments].filter(({ segment }) => segment.trim() !== "").length;
}
