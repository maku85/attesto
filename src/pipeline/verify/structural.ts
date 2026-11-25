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

/**
 * German writes ordinals with a full stop before a capitalized noun: "im 95. Perzentil", "15. März".
 * Only after an article or before a month, so that "auf 8. Leitete…" still counts as two sentences.
 */
const GERMAN_ORDINAL =
  /(?<=(?<!\p{L})(?:im|am|vom|zum|beim|der|die|das|dem|den|des)\s\d{1,2})\.(?=\s)|(?<=(?<!\d)\d{1,2})\.(?=\s(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)(?!\p{L}))/giu;

function countSentences(text: string, language: Lang): number {
  const plain = language === "de" ? text.replace(GERMAN_ORDINAL, "") : text;
  const segments = new Intl.Segmenter(language, { granularity: "sentence" }).segment(plain.trim());
  return [...segments].filter(({ segment }) => segment.trim() !== "").length;
}
