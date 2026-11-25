import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { JobAnalysis } from "../pipeline/analyze.ts";

/** Returns the ID under which the analysis can be used again. */
export function saveJobAnalysis(
  db: DatabaseSync,
  { posting, model, analysis }: { posting: string; model: string; analysis: JobAnalysis },
): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO job_analyses (id, created_at, posting, model, analysis) VALUES (?, ?, ?, ?, ?)",
  ).run(id, new Date().toISOString(), posting, model, JSON.stringify(analysis));
  return id;
}

export function getJobAnalysis(db: DatabaseSync, id: string): JobAnalysis | undefined {
  const row = db.prepare("SELECT analysis FROM job_analyses WHERE id = ?").get(id);
  return row && JobAnalysis.parse(JSON.parse(String(row.analysis)));
}
