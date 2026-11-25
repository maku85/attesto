import type { Lang } from "../../kb/schema.ts";
import type { Source } from "../../kb/sources.ts";
import type { LlmProvider } from "../../llm/provider.ts";
import type { Claim, Verification } from "../document.ts";
import { judge } from "./entailment.ts";
import { checkNumbers } from "./numeric.ts";
import { checkStructure } from "./structural.ts";

const PARALLEL_CLAIMS = 5;

export type VerifyContext = {
  provider: LlmProvider;
  judgeModel: string;
  /** The language the claims are written in. */
  language: Lang;
  /** Sources in their original language; a claim may cite only these. */
  sources: Map<string, Source>;
  sourceLanguage: Lang;
};
export type PlacedClaim = { slot: string; claim: Claim };
export type Checks = Pick<Verification, "structural" | "numeric" | "entailment">;

/** Structure, then numbers, then meaning. The judge is asked only if the first two pass. */
export async function checkClaim(
  { slot, claim }: PlacedClaim,
  { provider, judgeModel, language, sources, sourceLanguage }: VerifyContext,
): Promise<Checks> {
  const cited = claim.sources.flatMap((id) => sources.get(id) ?? []);
  const structural = checkStructure(claim, slot, language, sources);
  const numeric = checkNumbers(claim.text, language, cited, sourceLanguage);
  const entailment =
    structural.length === 0 && numeric.length === 0
      ? await judge(provider, judgeModel, claim.text, language, cited)
      : null;
  return { structural, numeric, entailment };
}

export function passes({ structural, numeric, entailment }: Checks): boolean {
  return structural.length === 0 && numeric.length === 0 && entailment?.verdict === "supported";
}

/** Keeps the order of the claims. */
export async function checkClaims(claims: PlacedClaim[], context: VerifyContext) {
  const results: { placed: PlacedClaim; checks: Checks }[] = [];
  const queue = claims.entries();
  const worker = async () => {
    for (const [i, placed] of queue) {
      results[i] = { placed, checks: await checkClaim(placed, context) };
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_CLAIMS }, worker));
  return results;
}
