import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { readAudit, writeAuditSample } from "../src/evals/audit.ts";
import { RECORDINGS } from "../src/evals/paths.ts";
import { loadPostings, measure, runPostings, totalMetrics } from "../src/evals/postings.ts";
import { fullReport, summaryTable, updateReadme, type EvalReport } from "../src/evals/report.ts";
import { runEval } from "../src/evals/run.ts";
import { loadSeeded, runSeeded, summarizeSeeded } from "../src/evals/seeded.ts";
import { formatRate, wilson } from "../src/evals/stats.ts";
import { LlmError } from "../src/llm/provider.ts";
import { ReplayProvider } from "../src/llm/replay.ts";
import { generateDocument } from "../src/pipeline/run.ts";
import { openDb } from "../src/store/db.ts";
import { PipelineProvider, analysis, exampleKb, requirement, runRequest } from "./fixtures.ts";
import { MockLlm } from "./mock-llm.ts";

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attesto-eval-"));
  db = openDb(join(dir, "evals.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
});

describe("statistics", () => {
  it.each([
    [0, 14, 0, 0.215],
    [14, 14, 0.785, 1],
    [5, 10, 0.237, 0.763],
  ])("gives the Wilson interval of %i in %i", (hits, of, low, high) => {
    expect(wilson(hits, of)[0]).toBeCloseTo(low, 2);
    expect(wilson(hits, of)[1]).toBeCloseTo(high, 2);
  });

  it("formats rates, also of nothing", () => {
    expect(formatRate({ hits: 5, of: 10 })).toBe("5/10 = 50% (23.7%–76.3%)");
    expect(formatRate({ hits: 0, of: 0 })).toBe("–");
  });
});

describe("seeded claims", () => {
  const all = loadSeeded();
  // The sets whose labels and design are ours; "blind" is whatever its authors made it.
  const claims = all.filter(({ set }) => set !== "blind");
  type Judge = ConstructorParameters<typeof PipelineProvider>[0]["judge"];
  const run = (judge?: Judge, repeat = 1, among = claims) =>
    runSeeded(among, exampleKb(), new PipelineProvider({ draft: [], judge }), "judge", repeat);

  it("have unique IDs and cover many kinds of falsehood", () => {
    expect(new Set(all.map(({ id }) => id)).size).toBe(all.length);
    expect(claims.filter(({ supported }) => !supported).length).toBeGreaterThanOrEqual(50);
    expect(claims.filter(({ supported }) => supported).length).toBeGreaterThanOrEqual(25);
    expect(new Set(claims.map(({ kind }) => kind)).size).toBeGreaterThanOrEqual(12);
    for (const { supported, kind } of all) expect(kind === "true").toBe(supported);
  });

  it("are caught by code where code is meant to catch them, and otherwise reach the judge", async () => {
    const results = await run();
    for (const { claim, attempts } of results) {
      const reached = attempts[0]?.entailment !== null;
      expect({ id: claim.id, reached }).toEqual({ id: claim.id, reached: claim.set !== "code" });
    }
  });

  it("include sentences by another author, most of which reach the judge", async () => {
    const blind = all.filter(({ set }) => set === "blind");
    const results = await run(undefined, 1, blind);
    const reached = results.filter(({ attempts }) => attempts[0]?.entailment !== null);
    expect(blind).toHaveLength(29);
    expect(reached.length).toBeGreaterThanOrEqual(28);
    // A true sentence that code stops is a defect of the code.
    expect(results.filter((r) => r.claim.supported && !reached.includes(r))).toEqual([]);
  });

  it("show an uncritical judge as missing every false claim that code does not catch", async () => {
    const summary = summarizeSeeded(await run());
    expect(summary.sets).toEqual([
      { set: "basic", accepted: { hits: 14, of: 14 }, rejected: { hits: 0, of: 12 } },
      { set: "code", accepted: { hits: 0, of: 17 }, rejected: { hits: 0, of: 0 } },
      { set: "hard", accepted: { hits: 27, of: 27 }, rejected: { hits: 0, of: 14 } },
    ]);
    expect(summary.kinds.find(({ kind }) => kind === "number")).toMatchObject({ byJudge: 0 });
  });

  it("show a judge that rejects everything as rejecting every true claim", async () => {
    const summary = summarizeSeeded(await run(() => "unsupported"));
    expect(summary.sets.map(({ accepted, rejected }) => [accepted.hits, rejected.hits])).toEqual([
      [0, 12],
      [0, 0],
      [0, 14],
    ]);
    expect(summary.wrong[0]).toMatchObject({ supported: true, reason: "judged unsupported" });
  });

  it("count a claim as wrong when one repetition is wrong", async () => {
    const one = claims.filter(({ id }) => id === "false-led");
    let asked = 0;
    const summary = summarizeSeeded(
      await run(() => (++asked === 2 ? "supported" : "unsupported"), 3, one),
    );
    expect(summary.sets[0]?.accepted).toEqual({ hits: 1, of: 1 });
    expect(summary.unstable).toEqual(["false-led"]);
  });
});

describe("postings", () => {
  it("are 20, in three languages", () => {
    const postings = loadPostings();
    expect(postings).toHaveLength(20);
    expect(new Set(postings.map(({ language }) => language))).toEqual(new Set(["de", "en", "it"]));
  });

  it("go on after a refusal, and stop when the connection is lost", async () => {
    const request = { db, kb: exampleKb(), draftModel: "d", judgeModel: "j" };
    const postings = loadPostings().slice(0, 2);
    const refusing = { generate: () => Promise.reject(new LlmError("refusal")) };
    expect(await runPostings(postings, { ...request, provider: refusing })).toMatchObject([
      { error: "refusal" },
      { error: "refusal" },
    ]);
    const offline = { generate: () => Promise.reject(new Error("offline")) };
    await expect(runPostings(postings, { ...request, provider: offline })).rejects.toThrow(
      "offline",
    );
  });

  it("count a requirement as addressed only if a cited entry speaks to it", async () => {
    const job = analysis(
      requirement("req-1", "must", "Kubernetes"),
      requirement("req-2", "must", "Terraform"),
      requirement("req-3", "must", "COBOL"),
    );
    const provider = new PipelineProvider({
      draft: [["summary", "Works on Kubernetes.", ["drv-skl-kubernetes"]]],
    });
    const run = await generateDocument({
      ...runRequest(db, provider),
      job: { id: runRequest(db, provider).job.id, analysis: job },
    });
    const claim = run.document.sections[0]!.claims[0]!;
    const addressing = (...ids: string[]) => {
      claim.addresses = ids;
      return measure(run, job, exampleKb()).addressed;
    };
    expect(measure(run, job, exampleKb())).toMatchObject({ requirements: 3, reachable: 2 });
    expect(addressing("req-1")).toBe(1);
    expect(addressing("req-1", "req-2", "req-3")).toBe(1);
    expect(addressing()).toBe(0);
  });

  it("report a number that slipped into the final text", async () => {
    const provider = new PipelineProvider({
      draft: [["exp-lagonube-2022", "Cut it to 8 minutes.", ["ach-lagonube-deploy-time"]]],
    });
    const request = runRequest(db, provider);
    const run = await generateDocument(request);
    expect(measure(run, request.job.analysis, exampleKb()).numericViolations).toBe(0);
    run.document.sections[0]!.claims[0]!.text = "Cut it to 7 minutes.";
    expect(measure(run, request.job.analysis, exampleKb()).numericViolations).toBe(1);
  });
});

describe("the whole suite with a mocked LLM", () => {
  const run = (provider = new MockLlm() as ConstructorParameters<typeof ReplayProvider>[1]) =>
    runEval({
      db,
      provider: provider!,
      mode: "replay",
      draftModel: "mock",
      judgeModel: "mock",
      repeat: 2,
      date: "2026-01-01",
    });

  it("drops every invented number, in 40 documents", async () => {
    const report = await run();
    const total = totalMetrics(report.postings);
    expect(report.postings).toHaveLength(40);
    expect(report.postings.filter((result) => "error" in result)).toEqual([]);
    expect(total.failed).toMatchObject({ structural: 0, numeric: 40 });
    expect(total.numericViolations).toBe(0);
    expect(total.accepted).toBe(total.drafted - 40 - total.failed.entailment);
    expect(total.accepted).toBeGreaterThan(40);
    expect(total.reachable).toBe(total.requirements - 40);
    expect(total.addressed).toBeGreaterThan(0);
    const texts = JSON.stringify(report.postings.map((r) => ("run" in r ? r.run.document : "")));
    expect(texts).not.toContain("987654");
  }, 60_000);

  it("gives the same report when replayed, and stores it", async () => {
    const path = join(dir, "recordings.jsonl");
    const live = await run(new ReplayProvider(path, new MockLlm()));
    const replayed = await run(new ReplayProvider(path));
    expect(fullReport(replayed)).toBe(fullReport(live));
    expect(db.prepare("SELECT count(*) AS n FROM eval_runs").get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT count(*) AS n FROM eval_results").get()).toEqual({ n: 80 });
  }, 60_000);
});

describe("audit", () => {
  const paths = () => ({ sample: join(dir, "sample.yaml"), key: join(dir, "key.json") });
  const results = async () => {
    const provider = new PipelineProvider({
      draft: [
        ["exp-lagonube-2022", "Cut it to 8 minutes.", ["ach-lagonube-deploy-time"]],
        ["exp-lagonube-2022", "Led it.", ["ach-lagonube-k8s-migration"]],
        ["exp-lagonube-2022", "Cut it by 99%.", ["ach-lagonube-cloud-cost"]],
      ],
      judge: (text) => (text === "Led it." ? "unsupported" : "supported"),
    });
    const run = await generateDocument(runRequest(db, provider));
    return [{ id: "x", type: "cv" as const, run, metrics: measure(run, analysis(), exampleKb()) }];
  };

  it("samples what the judge decided, without giving its verdict away", async () => {
    expect(writeAuditSample(await results(), exampleKb(), paths())).toBe(2);
    const text = readFileSync(paths().sample, "utf8");
    expect(text).toContain("median deployment time after: 8 minutes");
    expect(text).not.toMatch(/accepted|dropped|unsupported|99%|judged/);
  });

  it("counts errors in both directions once labelled, and never overwrites labels", async () => {
    writeAuditSample(await results(), exampleKb(), paths());
    expect(readAudit(paths())).toEqual({
      wronglyAccepted: { hits: 0, of: 0 },
      wronglyRejected: { hits: 0, of: 0 },
      unlabelled: 2,
    });
    const sample = parse(readFileSync(paths().sample, "utf8")) as {
      text: string;
      supported: boolean;
    }[];
    for (const item of sample) item.supported = item.text === "Led it.";
    writeFileSync(paths().sample, stringify(sample));
    expect(readAudit(paths())).toEqual({
      wronglyAccepted: { hits: 1, of: 1 },
      wronglyRejected: { hits: 1, of: 1 },
      unlabelled: 0,
    });
    const again = await results();
    expect(() => writeAuditSample(again, exampleKb(), paths())).toThrow("already exists");
  });
});

describe("report", () => {
  const report: EvalReport = {
    date: "2026-01-01",
    draftModel: "d",
    judgeModel: "j",
    repeat: 3,
    seeded: {
      sets: [
        { set: "a", accepted: { hits: 1, of: 10 }, rejected: { hits: 0, of: 5 } },
        { set: "b", accepted: { hits: 0, of: 10 }, rejected: { hits: 1, of: 5 } },
      ],
      kinds: [],
      wrong: [{ id: "x", text: "a | b", supported: false, reason: "" }],
      unstable: [],
    },
    postings: [{ id: "broken", type: "cv", error: "refusal" }],
    audit: {
      wronglyAccepted: { hits: 0, of: 3 },
      wronglyRejected: { hits: 0, of: 0 },
      unlabelled: 1,
    },
  };

  it("adds up the sets, and shows no audit before it is complete", () => {
    expect(summaryTable(report)).toContain("| Seeded false claims caught | 19/20 = 95%");
    expect(summaryTable(report)).toContain("wrongly rejected | 1/10 = 10%");
    expect(summaryTable(report)).toContain("finds unsupported | not labelled yet");
  });

  it("does not hide failures", () => {
    expect(fullReport(report)).toContain("**1 postings failed:** broken.");
    expect(fullReport(report)).toContain("| x | a \\| b | not supported | – |");
  });

  it("replaces only the table in the README", () => {
    const readme = "before\n<!-- eval:start -->\nold\n<!-- eval:end -->\nafter\n";
    const updated = updateReadme(readme, report);
    expect(updated).toMatch(
      /^before\n<!-- eval:start -->\n\n\| Metric[^]*\n\n<!-- eval:end -->\nafter\n$/,
    );
    expect(updateReadme(updated, report)).toBe(updated);
    expect(() => updateReadme("no markers", report)).toThrow("markers");
  });
});

// Runs in CI once answers of a real model are recorded.
it.skipIf(!existsSync(RECORDINGS))(
  "the recorded answers match the current prompts",
  async () => {
    const report = await runEval({
      db,
      provider: new ReplayProvider(RECORDINGS),
      mode: "replay",
      draftModel: "claude-opus-5-5",
      judgeModel: "claude-opus-5-5",
      repeat: 3,
      date: "2026-01-01",
    });
    expect(totalMetrics(report.postings).numericViolations).toBe(0);
  },
  60_000,
);
