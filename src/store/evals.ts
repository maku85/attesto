import type { DatabaseSync } from "node:sqlite";

export type StoredEval = {
  id: string;
  date: string;
  mode: "replay" | "live";
  draftModel: string;
  judgeModel: string;
  seeded: unknown;
  cases: { id: string; metrics: unknown }[];
};

export function storeEval(db: DatabaseSync, run: StoredEval): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO eval_runs VALUES (?, ?, ?, ?, ?, ?)").run(
      run.id,
      run.date,
      run.mode,
      run.draftModel,
      run.judgeModel,
      JSON.stringify({ seeded: run.seeded }),
    );
    const insert = db.prepare("INSERT INTO eval_results VALUES (?, ?, ?)");
    for (const { id, metrics } of run.cases) insert.run(run.id, id, JSON.stringify(metrics));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
