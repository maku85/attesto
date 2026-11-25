import { backs, extractQuantities } from "../../kb/quantities.ts";
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
    .map(({ raw }) => raw);
}
