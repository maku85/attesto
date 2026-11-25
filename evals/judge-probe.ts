// Asks the real judge about labelled claims. Needs ANTHROPIC_API_KEY and costs money:
//   pnpm judge:probe
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { loadKb } from "../src/kb/load.ts";
import { Lang } from "../src/kb/schema.ts";
import { listSources } from "../src/kb/sources.ts";
import { AnthropicProvider } from "../src/llm/anthropic.ts";
import { resolveJudgeModel, type LlmProvider } from "../src/llm/provider.ts";
import { checkClaims, passes } from "../src/pipeline/verify/index.ts";

const ProbeClaims = z.array(
  z.strictObject({
    id: z.string(),
    language: Lang,
    supported: z.boolean(),
    sources: z.array(z.string()),
    text: z.string(),
  }),
);

/** The day the labels refer to: after the example certification expired. */
const AS_OF = "2026-06-15";

export async function probeJudge(provider: LlmProvider, judgeModel: string) {
  const loaded = loadKb(join(import.meta.dirname, "..", "examples", "kb"));
  if (!loaded.ok) throw new Error("The example knowledge base is not valid");
  const { kb } = loaded;
  const sourceLanguage = kb.person.defaultLanguage;
  const sources = new Map(
    listSources(kb, AS_OF, sourceLanguage).map((source) => [source.id, source]),
  );
  const file = join(import.meta.dirname, "seeded", "judge-probe.yaml");
  const probes = ProbeClaims.parse(parse(readFileSync(file, "utf8")));

  // One language at a time, because it is part of the verification context.
  const results = [];
  for (const language of Lang.options) {
    const claims = probes
      .filter((probe) => probe.language === language)
      .map((probe) => ({ slot: "letter-body", claim: { ...probe, addresses: [] } }));
    const context = { provider, judgeModel, language, sources, sourceLanguage };
    for (const { placed, checks } of await checkClaims(claims, context)) {
      const probe = probes.find(({ id }) => id === placed.claim.id)!;
      results.push({ probe, checks, correct: passes(checks) === probe.supported });
    }
  }
  return results;
}

if (process.argv[1] === import.meta.filename) {
  const model = resolveJudgeModel();
  const results = await probeJudge(new AnthropicProvider(), model);
  for (const { probe, checks, correct } of results) {
    const verdict = checks.entailment?.verdict ?? "not judged";
    console.log(`${correct ? "ok   " : "WRONG"}  ${probe.id}: ${verdict}`);
    if (!correct) console.log(`       ${probe.text}\n       ${checks.entailment?.reason}`);
  }
  const rate = (supported: boolean) => {
    const group = results.filter(({ probe }) => probe.supported === supported);
    return `${group.filter(({ correct }) => !correct).length} of ${group.length}`;
  };
  console.log(`\nModel: ${model}`);
  console.log(`False claims accepted: ${rate(false)}`);
  console.log(`True claims rejected:  ${rate(true)}`);
  if (results.some(({ correct }) => !correct)) process.exitCode = 1;
}
