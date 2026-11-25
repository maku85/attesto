import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { KnowledgeBase } from "../kb/schema.ts";
import { resolveModel, type LlmProvider } from "../llm/provider.ts";
import { getJobAnalysis, saveJobAnalysis } from "../store/jobs.ts";
import { getRun, storeOutputHash } from "../store/runs.ts";
import { analyzePosting, type JobAnalysis } from "./analyze.ts";
import { buildReport, reportToMarkdown, type ProvenanceReport } from "./provenance.ts";
import type { Document } from "./document.ts";
import { htmlToPdf } from "./pdf.ts";
import { toHtml, toMarkdown } from "./render.ts";
import { generateDocument, type RunRequest, type RunResult } from "./run.ts";
import { layOut } from "./templates/index.ts";
import type { Template } from "./templates/styles.ts";
import { changedSources } from "./verify/document.ts";

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

export type Appearance = {
  template?: Template;
  photo?: boolean;
  /** A browser to print a PDF with; none is made without it. */
  browser?: string;
};
export type ProduceRequest = RunRequest & Appearance & { outDir: string };
export type ProduceResult = RunResult & { report: ProvenanceReport; files: string[] };

/** Generates a document and writes it to disk, with its provenance report. */
export async function produce(request: ProduceRequest): Promise<ProduceResult> {
  const { db, kb, job, outDir, template, photo = false, browser, onProgress } = request;
  // Before any paid call.
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const { document, verifications } = await generateDocument(request);

  onProgress?.("Rendering");
  const blocks = layOut({ document, kb, analysis: job.analysis, photo });
  const report = buildReport(document, blocks, verifications, kb);
  const html = toHtml(blocks, { lang: document.language, type: document.type, template });
  const write = outputWriter(db, document.runId, join(outDir, baseName(document)));
  const files = [
    write("md", toMarkdown(blocks)),
    write("html", html),
    write("document.json", JSON.stringify(document, null, 2) + "\n"),
    write("provenance.md", reportToMarkdown(report)),
    write("provenance.json", JSON.stringify(report, null, 2) + "\n"),
  ];
  // Last, so that a browser that fails cannot cost the rest.
  if (browser) files.push(write("pdf", await htmlToPdf(browser, html)));
  return { document, verifications, report, files };
}

export type RenderRequest = Appearance & {
  db: DatabaseSync;
  kb: KnowledgeBase;
  runId: string;
  outDir: string;
};

/**
 * Writes a past run in another template, without an LLM. Uses the stored document and decisions, never a
 * file, so it cannot be used to render a claim that was not accepted.
 */
export async function renderRun(request: RenderRequest): Promise<string[]> {
  const { db, kb, outDir, template = "classic", photo = false, browser } = request;
  const run = getRun(db, request.runId);
  if (!run) throw new Error(`No run has the ID ${request.runId}`);
  const { document, verifications } = run;
  if (!document) throw new Error(`Run ${run.id} has no document: it is ${run.status}`);
  const cited = new Set(
    document.sections.flatMap(({ claims }) => claims.flatMap((c) => c.sources)),
  );
  const changed = changedSources(
    document.sources.filter(({ id }) => cited.has(id)),
    kb,
    document.asOf,
  );
  if (changed.length > 0) {
    throw new Error(
      `Entries behind the claims have changed since (${changed.join(", ")}). Generate it again.`,
    );
  }
  const { analysis } = storedJob(db, run.jobAnalysisId);
  const blocks = layOut({ document, kb, analysis, photo });
  buildReport(document, blocks, verifications, kb);
  const html = toHtml(blocks, { lang: document.language, type: document.type, template });

  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const write = outputWriter(db, document.runId, join(outDir, baseName(document)));
  const files = [write(`${template}.html`, html)];
  if (browser) files.push(write(`${template}.pdf`, await htmlToPdf(browser, html)));
  return files;
}

/** The run ID keeps a new run from overwriting an earlier one, which may have been edited. */
function baseName({ type, language, runId }: Document): string {
  return `${type}-${language}-${runId.slice(0, 8)}`;
}

/** Never overwrites, and records the hash of what it wrote. */
function outputWriter(db: DatabaseSync, runId: string, base: string) {
  return (extension: string, content: string | Buffer): string => {
    const file = `${base}.${extension}`;
    try {
      writeFileSync(file, content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw new Error(`${file} already exists`, { cause: error });
    }
    storeOutputHash(db, runId, extension, createHash("sha256").update(content).digest("hex"));
    return file;
  };
}

/** Today in the local time zone, as YYYY-MM-DD. */
export function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
