import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { Lang, type KnowledgeBase } from "../kb/schema.ts";
import { listSources } from "../kb/sources.ts";
import type { LlmProvider } from "../llm/provider.ts";
import { checkClaims, passes, type Checks } from "../pipeline/verify/index.ts";
import { EVAL_DATE, SEEDED } from "./paths.ts";
import type { Count } from "./stats.ts";

const SeededClaim = z.strictObject({
  id: z.string(),
  /** "true", or what is wrong with it. */
  kind: z.string(),
  slot: z.string().default("letter-body"),
  language: Lang,
  supported: z.boolean(),
  sources: z.array(z.string()),
  text: z.string(),
});
export type SeededClaim = z.infer<typeof SeededClaim> & { set: string };

export function loadSeeded(): SeededClaim[] {
  return readdirSync(SEEDED)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .flatMap((file) => {
      const claims = z
        .array(SeededClaim)
        .parse(parse(readFileSync(join(SEEDED, file), "utf8")) ?? []);
      return claims.map((claim) => ({ ...claim, set: file.replace(/\.yaml$/, "") }));
    });
}

export type SeededResult = { claim: SeededClaim; attempts: Checks[] };

/** Verifies every claim `repeat` times, because a judge need not answer the same twice. */
export async function runSeeded(
  claims: SeededClaim[],
  kb: KnowledgeBase,
  provider: LlmProvider,
  judgeModel: string,
  repeat: number,
): Promise<SeededResult[]> {
  const sourceLanguage = kb.person.defaultLanguage;
  const sources = new Map(
    listSources(kb, EVAL_DATE, sourceLanguage).map((source) => [source.id, source]),
  );
  const results = new Map(claims.map((claim) => [claim.id, { claim, attempts: [] as Checks[] }]));
  for (let i = 0; i < repeat; i++) {
    for (const language of Lang.options) {
      const placed = claims
        .filter((claim) => claim.language === language)
        .map(({ id, slot, text, sources }) => ({
          slot,
          claim: { id, text, sources, addresses: [] },
        }));
      const context = { provider, judgeModel, language, sources, sourceLanguage };
      for (const {
        placed: { claim },
        checks,
      } of await checkClaims(placed, context)) {
        results.get(claim.id)?.attempts.push(checks);
      }
    }
  }
  return [...results.values()];
}

/** Wrong in any repetition counts as wrong. */
function isWrong({ claim, attempts }: SeededResult): boolean {
  return attempts.some((checks) => passes(checks) !== claim.supported);
}

function wasUnstable({ attempts }: SeededResult): boolean {
  return new Set(attempts.map(passes)).size > 1;
}

export type SeededSummary = {
  /** Per set: false claims accepted, and true claims rejected. */
  sets: { set: string; accepted: Count; rejected: Count }[];
  /** Per kind of false claim: how many were caught, and by what. */
  kinds: { kind: string; caught: Count; byCode: number; byJudge: number }[];
  wrong: { id: string; text: string; supported: boolean; reason: string }[];
  unstable: string[];
};

export function summarizeSeeded(results: SeededResult[]): SeededSummary {
  const count = (group: SeededResult[]): Count => ({
    hits: group.filter(isWrong).length,
    of: group.length,
  });
  const groups = (key: (claim: SeededClaim) => string, among = results) => [
    ...Map.groupBy(among, ({ claim }) => key(claim)),
  ];
  const falseClaims = results.filter(({ claim }) => !claim.supported);

  return {
    sets: groups(({ set }) => set).map(([set, group]) => ({
      set,
      accepted: count(group.filter(({ claim }) => !claim.supported)),
      rejected: count(group.filter(({ claim }) => claim.supported)),
    })),
    kinds: groups(({ kind }) => kind, falseClaims).map(([kind, group]) => {
      const caught = group.filter((result) => !isWrong(result));
      const byJudge = caught.filter(({ attempts }) => attempts[0]?.entailment).length;
      return {
        kind,
        caught: { hits: caught.length, of: group.length },
        byCode: caught.length - byJudge,
        byJudge,
      };
    }),
    wrong: results.filter(isWrong).map(({ claim, attempts }) => {
      const checks = attempts.find((attempt) => passes(attempt) !== claim.supported);
      const reason = [
        ...(checks?.structural ?? []),
        ...(checks?.numeric ?? []),
        checks?.entailment?.reason ?? "",
      ].join("; ");
      return { id: claim.id, text: claim.text, supported: claim.supported, reason };
    }),
    unstable: results.filter(wasUnstable).map(({ claim }) => claim.id),
  };
}
