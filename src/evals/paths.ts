import { join } from "node:path";

// Resolves to the repository from both src/evals and dist/evals.
const ROOT = join(import.meta.dirname, "..", "..");

export const EXAMPLE_KB = join(ROOT, "examples", "kb");
export const README = join(ROOT, "README.md");
export const POSTINGS = join(ROOT, "evals", "postings");
export const SEEDED = join(ROOT, "evals", "seeded");
export const RECORDINGS = join(ROOT, "evals", "recordings.jsonl");
export const RESULTS = join(ROOT, "evals", "results.md");
export const AUDIT_SAMPLE = join(ROOT, "evals", "audit-sample.yaml");
export const AUDIT_KEY = join(ROOT, "evals", "audit-key.json");

/** Fixed, so that derived durations and prompts stay the same. After the example certification
 * expired. */
export const EVAL_DATE = "2026-06-15";
