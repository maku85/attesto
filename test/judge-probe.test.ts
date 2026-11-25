import { expect, it } from "vitest";
import { probeJudge } from "../evals/judge-probe.ts";
import { PipelineProvider } from "./fixtures.ts";

it("every probe claim reaches the judge, and an uncritical judge fails the false ones", async () => {
  const results = await probeJudge(new PipelineProvider({ draft: [] }), "judge-model");
  const stopped = results.filter(({ checks }) => checks.entailment === null);
  expect(stopped.map(({ probe, checks }) => ({ id: probe.id, ...checks }))).toEqual([]);
  expect(results.filter(({ correct }) => correct)).toEqual(
    results.filter(({ probe }) => probe.supported),
  );
  expect(results.filter(({ probe }) => probe.supported)).toHaveLength(12);
  expect(results.filter(({ probe }) => !probe.supported)).toHaveLength(14);
});
