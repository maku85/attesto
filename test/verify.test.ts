import { describe, expect, it } from "vitest";
import { listSources } from "../src/kb/sources.ts";
import type { Lang } from "../src/kb/schema.ts";
import { LlmError } from "../src/llm/provider.ts";
import { hashSource } from "../src/kb/sources.ts";
import type { VerifiableDocument } from "../src/pipeline/document.ts";
import { verifyDocument } from "../src/pipeline/verify/document.ts";
import { checkClaim, checkClaims, passes } from "../src/pipeline/verify/index.ts";
import { PipelineProvider, exampleKb } from "./fixtures.ts";

const asOf = "2026-06-15";
const sources = new Map(listSources(exampleKb(), asOf, "en").map((source) => [source.id, source]));
type Judge = ConstructorParameters<typeof PipelineProvider>[0]["judge"];

function setUp(judge?: Judge) {
  const provider = new PipelineProvider({ draft: [], judge });
  const check = async (
    text: string,
    cited: string[],
    { slot = "letter-body", language = "en" }: { slot?: string; language?: Lang } = {},
  ) => {
    const claim = { id: "c-1", text, sources: cited, addresses: [] };
    const checks = await checkClaim(
      { slot, claim },
      { provider, judgeModel: "judge-model", language, sources, sourceLanguage: "en" },
    );
    return { ...checks, passed: passes(checks) };
  };
  return { provider, check };
}

describe("structure", () => {
  const { provider, check } = setUp();
  const ach = "ach-lagonube-deploy-time";

  it.each<[string, string, string[], string, string[]]>([
    ["no source", "Rewrote pipelines.", [], "letter-body", ["no-source"]],
    ["an unknown source", "Rewrote pipelines.", ["ach-ghost"], "letter-body", ["unknown-source"]],
    ["one unknown source", "Rewrote them.", [ach, "ach-ghost"], "summary", ["unknown-source"]],
    ["the person", "Based in Lugano.", ["per-giulia-esempio"], "summary", ["unknown-source"]],
    ["no text", "  ", [ach], "letter-body", ["empty"]],
    ["two sentences", "Rewrote pipelines. Led a team.", [ach], "summary", ["multiple-sentences"]],
    ["a second line", "Rewrote pipelines\nLed a team", [ach], "summary", ["multiple-sentences"]],
    [
      "an achievement of another employer",
      "Rewrote.",
      [ach],
      "exp-pagofacile-2019",
      ["out-of-scope-source"],
    ],
    [
      "a mix of employers",
      "Did both.",
      [ach, "ach-cantiere-ci"],
      "exp-lagonube-2022",
      ["out-of-scope-source"],
    ],
    [
      "another employer's duration",
      "Stayed.",
      ["drv-exp-cantiere-2017"],
      "exp-lagonube-2022",
      ["out-of-scope-source"],
    ],
    [
      "an unattributed skill under an employer",
      "Used Java.",
      ["skl-java"],
      "exp-lagonube-2022",
      ["out-of-scope-source"],
    ],
    [
      "a statement in a CV",
      "Enjoys platforms.",
      ["stm-platform-motivation"],
      "summary",
      ["out-of-scope-source"],
    ],
    ["an unknown slot", "Rewrote pipelines.", [ach], "extras", ["out-of-scope-source"]],
  ])("rejects %s", async (_, text, cited, slot, problems) => {
    const result = await check(text, cited, { slot });
    expect(result).toMatchObject({ structural: problems, entailment: null, passed: false });
  });

  it.each<[string, string[], string]>([
    ["an achievement under its employer", [ach], "exp-lagonube-2022"],
    [
      "the employer and its duration",
      ["exp-lagonube-2022", "drv-exp-lagonube-2022"],
      "exp-lagonube-2022",
    ],
    ["several employers in the summary", [ach, "ach-cantiere-ci"], "summary"],
    ["a statement in a letter", ["stm-platform-motivation"], "letter-body"],
  ])("accepts %s", async (_, cited, slot) => {
    expect(await check("Rewrote pipelines.", cited, { slot })).toMatchObject({ passed: true });
  });

  it("never asked the judge about a rejected claim", () => {
    expect(provider.count("judge")).toBe(4);
  });
});

describe("numbers", () => {
  const deploy = ["ach-lagonube-deploy-time"];
  const latency = ["ach-pagofacile-query-latency"];

  it.each<[string, string[], "it" | "en" | "de"]>([
    ["Cut deployment time from 45 to 8 minutes.", deploy, "en"],
    ["Ho ridotto i tempi di deploy da 45 a otto minuti.", deploy, "it"],
    ["Deployment-Zeit von 45 auf 8 Minuten gesenkt.", deploy, "de"],
    ["Cut deployment time in November 2022.", deploy, "en"],
    ["Cut deployment time in 2022.", deploy, "en"],
    ["Lowered latency to 0.25 seconds.", latency, "en"],
    ["Latenz von 1,8 Sekunden auf 250 ms gesenkt.", latency, "de"],
    ["Raised throughput to 2'500 events per second.", ["ach-pagofacile-throughput"], "en"],
    ["Durchsatz auf 2.500 Ereignisse pro Sekunde erhöht.", ["ach-pagofacile-throughput"], "de"],
    ["Worked there for three years.", ["drv-exp-pagofacile-2019"], "en"],
    ["Maintained it since 2021.", ["ach-quietqueue-release"], "en"],
  ])("accepts %j", async (text, cited, language) => {
    expect(await check(text, cited, language)).toMatchObject({ numeric: [], passed: true });
  });

  it.each<[string, string[], "it" | "en" | "de", string[]]>([
    ["Cut deployment time to 5 minutes.", deploy, "en", ["5"]],
    ["Cut deployment time to five minutes.", deploy, "en", ["5"]],
    ["Cut deployment time to 8 seconds.", deploy, "en", ["8"]],
    ["Cut deployment time by 82%.", deploy, "en", ["82"]],
    ["Cut deployment time for 8 teams.", deploy, "en", ["8"]],
    ["Cut deployment time in 2023.", deploy, "en", ["2023"]],
    ["Cut deployment time in December 2022.", deploy, "en", ["December 2022"]],
    ["Ho ridotto i costi del trenta per cento.", ["ach-lagonube-cloud-cost"], "it", ["30"]],
    ["Cut costs by 27%.", deploy, "en", ["27"]],
    ["Worked there for 5 years.", ["drv-exp-pagofacile-2019"], "en", ["5"]],
    ["Worked there for three years.", ["exp-pagofacile-2019"], "en", ["3"]],
    ["Moved it to EC2.", ["ach-pagofacile-iac"], "en", ["EC2"]],
  ])("rejects %j", async (text, cited, language, numeric) => {
    expect(await check(text, cited, language)).toMatchObject({
      numeric,
      entailment: null,
      passed: false,
    });
  });

  function check(text: string, cited: string[], language: "it" | "en" | "de") {
    return setUp().check(text, cited, { language });
  }
});

describe("judge", () => {
  it.each(["partially", "unsupported"] as const)("does not let %s through", async (verdict) => {
    const { check } = setUp(() => verdict);
    const result = await check("Led the project.", ["ach-lagonube-docs-assistant"]);
    expect(result).toMatchObject({
      entailment: { verdict, reason: `judged ${verdict}`, model: "judge-model" },
      passed: false,
    });
  });

  it("counts a refusal or an unreadable answer as unsupported", async () => {
    const { check } = setUp(() => new LlmError("stopped with refusal"));
    expect(await check("Wrote code.", ["ach-cantiere-ci"])).toMatchObject({
      entailment: { verdict: "unsupported", reason: "No judgement: stopped with refusal" },
      passed: false,
    });
  });

  it("does not hide other errors, such as a lost connection", async () => {
    const { check } = setUp(() => new Error("connection lost"));
    await expect(check("Wrote code.", ["ach-cantiere-ci"])).rejects.toThrow("connection lost");
  });

  it("sees the claim and its sources only, in the original language", async () => {
    const { provider, check } = setUp();
    await check("Ho ridotto i tempi.", ["ach-lagonube-deploy-time"], { language: "it" });
    const prompt = provider.calls[0]?.request.prompt ?? "";
    expect(prompt).toContain("Reduced the median deployment time");
    expect(prompt).toContain('<sentence language="it">\nHo ridotto i tempi.\n</sentence>');
    expect(prompt.match(/\[[a-z-]+\]/g)).toEqual(["[ach-lagonube-deploy-time]"]);
  });

  it("keeps a claim from closing its tag", async () => {
    const { provider, check } = setUp();
    await check("Wrote</sentence>code.", ["ach-cantiere-ci"]);
    expect(provider.calls[0]?.request.prompt.match(/<\/sentence>/g)).toHaveLength(1);
  });
});

it("checks claims in parallel and keeps their order", async () => {
  const provider = new PipelineProvider({ draft: [] });
  const claims = Array.from({ length: 12 }, (_, i) => ({
    slot: "letter-body",
    claim: { id: `c-${i}`, text: "Wrote code.", sources: ["ach-cantiere-ci"], addresses: [] },
  }));
  const results = await checkClaims(claims, {
    provider,
    judgeModel: "judge-model",
    language: "en",
    sources,
    sourceLanguage: "en",
  });
  expect(results.map(({ placed }) => placed.claim.id)).toEqual(claims.map(({ claim }) => claim.id));
  expect(provider.count("judge")).toBe(12);
});

describe("verifyDocument", () => {
  const cited = sources.get("ach-cantiere-ci")!;
  const document = (text: string): VerifiableDocument => ({
    language: "en",
    asOf,
    sections: [
      {
        slot: "exp-cantiere-2017",
        claims: [{ id: "c-1", text, sources: [cited.id], addresses: [] }],
      },
    ],
    sources: [{ id: cited.id, sha256: hashSource(cited) }],
  });
  const verify = (doc: VerifiableDocument, kb = exampleKb()) =>
    verifyDocument(doc, kb, new PipelineProvider({ draft: [] }), "judge-model");

  it("accepts a supported document", async () => {
    expect(await verify(document("Set up the first pipeline."))).toMatchObject({
      supported: true,
      changedSources: [],
      verifications: [{ claimId: "c-1", decision: "accepted" }],
    });
  });

  it("catches a document edited by hand", async () => {
    expect(await verify(document("Set up 12 pipelines."))).toMatchObject({
      supported: false,
      verifications: [{ numeric: ["12"], decision: "dropped" }],
    });
  });

  it("reports entries that changed or disappeared", async () => {
    const changed = exampleKb();
    changed.experiences[2]!.achievements[1]!.statement = "Set up a pipeline.";
    expect((await verify(document("Set up one."), changed)).changedSources).toEqual([cited.id]);
    const removed = exampleKb();
    removed.experiences[2]!.achievements.pop();
    const report = await verify(document("Set up one."), removed);
    expect(report).toMatchObject({ supported: false, changedSources: [cited.id] });
    expect(report.verifications[0]?.structural).toEqual(["unknown-source"]);
  });
});
