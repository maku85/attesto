import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolveModel, type LlmProvider } from "../llm/provider.ts";
import { getJobAnalysis, saveJobAnalysis } from "../store/jobs.ts";
import { storeOutputHashes } from "../store/runs.ts";
import { analyzePosting, type JobAnalysis } from "./analyze.ts";
import { buildReport, reportToMarkdown, type ProvenanceReport } from "./provenance.ts";
import { toHtml, toMarkdown } from "./render.ts";
import { generateDocument, type RunRequest, type RunResult } from "./run.ts";
import { layOut } from "./templates/index.ts";

export type Job = { id: string; analysis: JobAnalysis };

export async function analyzeAndStore(
  db: DatabaseSync,
  provider: LlmProvider,
  posting: string,
): Promise<Job> {
  const model = resolveModel();
  const analysis = await analyzePosting(provider, model, posting);
  return { id: saveJobAnalysis(db, { posting, model, analysis }), analysis };
}

export function storedJob(db: DatabaseSync, id: string): Job {
  const analysis = getJobAnalysis(db, id);
  if (!analysis) throw new Error(`No job analysis has the ID ${id}`);
  return { id, analysis };
}

export type ProduceRequest = RunRequest & { outDir: string; photo?: boolean };
export type ProduceResult = RunResult & { report: ProvenanceReport; files: string[] };

/** Generates a document and writes it to disk, with its provenance report. */
export async function produce(request: ProduceRequest): Promise<ProduceResult> {
  const { db, kb, job, outDir, photo = false, onProgress } = request;
  // Before any paid call.
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const { document, verifications } = await generateDocument(request);

  onProgress?.("Rendering");
  const blocks = layOut({ document, kb, analysis: job.analysis, photo });
  const report = buildReport(document, blocks, verifications, kb);
  const contents = {
    md: toMarkdown(blocks),
    html: toHtml(blocks, document.language),
    "document.json": JSON.stringify(document, null, 2) + "\n",
    "provenance.md": reportToMarkdown(report),
    "provenance.json": JSON.stringify(report, null, 2) + "\n",
  };
  // The run ID keeps a new run from overwriting an earlier one, which may have been edited.
  const name = `${document.type}-${document.language}-${document.runId.slice(0, 8)}`;
  const files = Object.entries(contents).map(([extension, content]) => {
    const file = join(outDir, `${name}.${extension}`);
    writeFileSync(file, content, { flag: "wx", mode: 0o600 });
    return file;
  });
  storeOutputHashes(
    db,
    document.runId,
    Object.fromEntries(
      Object.entries(contents).map(([extension, content]) => [
        extension,
        createHash("sha256").update(content).digest("hex"),
      ]),
    ),
  );
  return { document, verifications, report, files };
}

/** Today in the local time zone, as YYYY-MM-DD. */
export function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
