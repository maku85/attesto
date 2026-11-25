import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Lang, type KnowledgeBase } from "../kb/schema.ts";
import { listSources } from "../kb/sources.ts";
import { LlmError, type LlmProvider } from "../llm/provider.ts";
import { analyzePosting, type JobAnalysis } from "../pipeline/analyze.ts";
import { DOCUMENT_TYPES, type Document, type Verification } from "../pipeline/document.ts";
import { retrieve } from "../pipeline/retrieve.ts";
import { generateDocument, type RunResult } from "../pipeline/run.ts";
import { checkNumbers } from "../pipeline/verify/numeric.ts";
import { saveJobAnalysis } from "../store/jobs.ts";
import { EVAL_DATE, POSTINGS } from "./paths.ts";

export type Posting = { id: string; language: Lang; text: string };

/** The language is the first part of the file name. */
export function loadPostings(): Posting[] {
  return readdirSync(POSTINGS)
    .filter((file) => file.endsWith(".txt"))
    .sort()
    .map((file) => ({
      id: basename(file, ".txt"),
      language: Lang.parse(file.split("-")[0]),
      text: readFileSync(join(POSTINGS, file), "utf8"),
    }));
}

export type DocumentMetrics = {
  requirements: number;
  /** Requirements that at least one entry speaks to; the others are gaps of the person. */
  reachable: number;
  addressed: number;
  drafted: number;
  accepted: number;
  acceptedAfterRewrite: number;
  /** Drafted claims that failed, by the first layer that failed them. */
  failed: { structural: number; numeric: number; entailment: number };
  /** Numbers in the final text that its sources do not state. Anything but 0 is a bug. */
  numericViolations: number;
};
export type PostingResult = { id: string; type: Document["type"] } & (
  { metrics: DocumentMetrics; run: RunResult } | { error: string }
);

export type PostingsRequest = {
  db: DatabaseSync;
  kb: KnowledgeBase;
  provider: LlmProvider;
  draftModel: string;
  judgeModel: string;
  onProgress?: (step: string) => void;
};

/** A CV and a letter for every posting, in its language. */
export async function runPostings(
  postings: Posting[],
  request: PostingsRequest,
): Promise<PostingResult[]> {
  const { db, kb, provider, draftModel, onProgress } = request;
  const results: PostingResult[] = [];
  for (const { id, language, text } of postings) {
    onProgress?.(id);
    try {
      const analysis = await analyzePosting(provider, draftModel, text);
      const job = {
        id: saveJobAnalysis(db, { posting: text, model: draftModel, analysis }),
        analysis,
      };
      for (const type of DOCUMENT_TYPES) {
        const run = await generateDocument({
          ...request,
          job,
          type,
          language,
          market: `ch-${language}`,
          asOf: EVAL_DATE,
          onProgress: undefined,
        });
        results.push({ id, type, run, metrics: measure(run, analysis, kb) });
      }
    } catch (error) {
      // One refused posting must not cost the results of the others. A lost connection is different.
      if (!(error instanceof LlmError)) throw error;
      results.push({ id, type: "cv", error: error.message });
    }
  }
  return results;
}

export function measure(
  { document, verifications }: RunResult,
  analysis: JobAnalysis,
  kb: KnowledgeBase,
): DocumentMetrics {
  const matched = new Map(
    retrieve(kb, analysis, { asOf: EVAL_DATE }).map(({ id, requirements }) => [id, requirements]),
  );
  const claims = document.sections.flatMap((section) => section.claims);
  // The drafter says what a claim addresses; that counts only if a cited entry speaks to it.
  const addressed = new Set(
    claims.flatMap(({ sources, addresses }) => {
      const spokenTo = sources.flatMap((id) => matched.get(id.replace(/^drv-/, "")) ?? []);
      return addresses.filter((requirement) => spokenTo.includes(requirement));
    }),
  );
  const sourceLanguage = kb.person.defaultLanguage;
  const sources = listSources(kb, EVAL_DATE, sourceLanguage);
  const first = verifications.filter(({ attempt }) => attempt === 1);
  return {
    requirements: analysis.requirements.length,
    reachable: new Set([...matched.values()].flat()).size,
    addressed: addressed.size,
    drafted: first.length,
    accepted: claims.length,
    acceptedAfterRewrite: verifications.filter(
      ({ attempt, decision }) => attempt === 2 && decision === "accepted",
    ).length,
    failed: countFailures(first),
    numericViolations: claims.flatMap(({ text, sources: ids }) =>
      checkNumbers(
        text,
        document.language,
        sources.filter(({ id }) => ids.includes(id)),
        sourceLanguage,
      ),
    ).length,
  };
}

function countFailures(verifications: Verification[]): DocumentMetrics["failed"] {
  const failed = { structural: 0, numeric: 0, entailment: 0 };
  for (const { structural, numeric, decision } of verifications) {
    if (decision === "accepted") continue;
    if (structural.length > 0) failed.structural += 1;
    else if (numeric.length > 0) failed.numeric += 1;
    else failed.entailment += 1;
  }
  return failed;
}

export function totalMetrics(results: PostingResult[]): DocumentMetrics {
  const all = results.flatMap((result) => ("metrics" in result ? [result.metrics] : []));
  const sum = (pick: (metrics: DocumentMetrics) => number) =>
    all.reduce((total, metrics) => total + pick(metrics), 0);
  return {
    requirements: sum((m) => m.requirements),
    reachable: sum((m) => m.reachable),
    addressed: sum((m) => m.addressed),
    drafted: sum((m) => m.drafted),
    accepted: sum((m) => m.accepted),
    acceptedAfterRewrite: sum((m) => m.acceptedAfterRewrite),
    failed: {
      structural: sum((m) => m.failed.structural),
      numeric: sum((m) => m.failed.numeric),
      entailment: sum((m) => m.failed.entailment),
    },
    numericViolations: sum((m) => m.numericViolations),
  };
}
