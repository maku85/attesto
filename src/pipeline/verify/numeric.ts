import { backs, extractQuantities, type Quantity } from "../../kb/quantities.ts";
import type { Lang } from "../../kb/schema.ts";
import type { Source } from "../../kb/sources.ts";

/** Returns the numbers in the claim that no cited source states. */
export function checkNumbers(
  text: string,
  language: Lang,
  cited: Source[],
  sourceLanguage: Lang,
): string[] {
  const stated = cited.flatMap(({ facts }) =>
    facts.flatMap((fact) => extractQuantities(fact, sourceLanguage)),
  );
  return extractQuantities(text, language)
    .filter((quantity) => !stated.some((source) => backs(source, quantity)))
    .filter((quantity) => !isSmallCountInWords(quantity, text))
    .map(({ raw }) => raw);
}

/**
 * "Two" and "three" as plain counts often count the sentence's own words ("two technologies I know
 * well"), so the judge decides them. Written as digits, or with a unit, they stay strict.
 */
function isSmallCountInWords({ kind, raw }: Quantity, text: string): boolean {
  return (
    kind === "count" &&
    (raw === "2" || raw === "3") &&
    !new RegExp(`(?<!\\d)${raw}(?!\\d)`).test(text)
  );
}
