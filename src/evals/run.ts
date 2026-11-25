import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { loadKb } from "../kb/load.ts";
import type { LlmProvider } from "../llm/provider.ts";
import { storeEval } from "../store/evals.ts";
import { readAudit } from "./audit.ts";
import { EXAMPLE_KB } from "./paths.ts";
import { loadPostings, runPostings } from "./postings.ts";
import type { EvalReport } from "./report.ts";
import { loadSeeded, runSeeded, summarizeSeeded } from "./seeded.ts";

export type EvalRequest = {
  db: DatabaseSync;
  provider: LlmProvider;
  mode: "replay" | "live";
  draftModel: string;
  judgeModel: string;
  repeat: number;
  /** Leave out to run everything. */
  only?: "seeded" | "postings";
  date: string;
  onProgress?: (step: string) => void;
};

export async function runEval(request: EvalRequest): Promise<EvalReport> {
  const { db, provider, mode, draftModel, judgeModel, repeat, only, date, onProgress } = request;
  const loaded = loadKb(EXAMPLE_KB);
  if (!loaded.ok) throw new Error("The example knowledge base is not valid");
  const { kb } = loaded;

  if (only !== "postings") onProgress?.("Seeded claims");
  const claims = only === "postings" ? [] : loadSeeded();
  const seeded = summarizeSeeded(await runSeeded(claims, kb, provider, judgeModel, repeat));
  const postings = await runPostings(only === "seeded" ? [] : loadPostings(), {
    db,
    kb,
    provider,
    draftModel,
    judgeModel,
    onProgress,
  });
  const cases = postings.map((result) => ({
    id: `${result.id}/${result.type}`,
    metrics: "metrics" in result ? result.metrics : { error: result.error },
  }));
  storeEval(db, { id: randomUUID(), date, mode, draftModel, judgeModel, seeded, cases });
  return { date, draftModel, judgeModel, repeat, seeded, postings, audit: readAudit() };
}
