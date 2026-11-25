import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Document, Tone, Verification } from "../pipeline/document.ts";

type NewRun = Pick<Document, "type" | "language" | "market" | "asOf" | "sources"> & {
  jobAnalysisId: string;
  draftModel: string;
  judgeModel: string;
  tone: Tone | null;
};
export type RunSummary = {
  id: string;
  createdAt: string;
  status: "running" | "completed" | "failed";
  type: Document["type"];
  language: Document["language"];
  market: Document["market"];
};
export type Run = RunSummary &
  Omit<NewRun, keyof RunSummary> & {
    error: string | null;
    document: Document | null;
    outputHashes: Record<string, string> | null;
    verifications: Verification[];
  };

export function createRun(db: DatabaseSync, run: NewRun): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO runs (id, created_at, status, job_analysis_id, type, language, market, as_of,
       draft_model, judge_model, tone, sources)
     VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    new Date().toISOString(),
    run.jobAnalysisId,
    run.type,
    run.language,
    run.market,
    run.asOf,
    run.draftModel,
    run.judgeModel,
    run.tone,
    JSON.stringify(run.sources),
  );
  return id;
}

/** Stores the document together with every decision, or neither. */
export function completeRun(
  db: DatabaseSync,
  document: Document,
  verifications: Verification[],
): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const insert = db.prepare("INSERT INTO verifications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const v of verifications) {
      insert.run(
        document.runId,
        v.claimId,
        v.attempt,
        v.text,
        JSON.stringify(v.sources),
        JSON.stringify(v.structural),
        JSON.stringify(v.numeric),
        v.entailment && JSON.stringify(v.entailment),
        v.decision,
      );
    }
    db.prepare("UPDATE runs SET status = 'completed', document = ? WHERE id = ?").run(
      JSON.stringify(document),
      document.runId,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function failRun(db: DatabaseSync, id: string, error: string): void {
  db.prepare("UPDATE runs SET status = 'failed', error = ? WHERE id = ?").run(error, id);
}

export function storeOutputHashes(
  db: DatabaseSync,
  id: string,
  hashes: Record<string, string>,
): void {
  db.prepare("UPDATE runs SET output_hashes = ? WHERE id = ?").run(JSON.stringify(hashes), id);
}

const SUMMARY = "id, created_at AS createdAt, status, type, language, market";

export function listRuns(db: DatabaseSync): RunSummary[] {
  return db
    .prepare(`SELECT ${SUMMARY} FROM runs ORDER BY created_at DESC, id`)
    .all() as unknown as RunSummary[];
}

export function getRun(db: DatabaseSync, id: string): Run | undefined {
  const row = db
    .prepare(
      `SELECT ${SUMMARY}, error, job_analysis_id AS jobAnalysisId, as_of AS asOf,
         draft_model AS draftModel, judge_model AS judgeModel, tone, sources, document,
         output_hashes AS outputHashes
       FROM runs WHERE id = ?`,
    )
    .get(id);
  if (!row) return undefined;
  const verifications = db
    .prepare(
      `SELECT claim_id AS claimId, attempt, text, sources, structural, numeric, entailment, decision
       FROM verifications WHERE run_id = ? ORDER BY rowid`,
    )
    .all(id);
  return {
    ...parseColumns(row, "sources", "document", "outputHashes"),
    verifications: verifications.map((verification) =>
      parseColumns(verification, "sources", "structural", "numeric", "entailment"),
    ),
  } as unknown as Run;
}

function parseColumns(row: Record<string, unknown>, ...columns: string[]) {
  const parsed = { ...row };
  for (const column of columns) {
    const value = row[column];
    if (typeof value === "string") parsed[column] = JSON.parse(value);
  }
  return parsed;
}
