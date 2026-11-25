import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { loadKb } from "../src/kb/load.ts";
import type { KnowledgeBase } from "../src/kb/schema.ts";
import type { LlmProvider, LlmRequest } from "../src/llm/provider.ts";
import type { JobAnalysis } from "../src/pipeline/analyze.ts";
import type { RunRequest } from "../src/pipeline/run.ts";
import { saveJobAnalysis } from "../src/store/jobs.ts";

export const ROOT = join(import.meta.dirname, "..");
export const EXAMPLE_KB = join(ROOT, "examples", "kb");

/** A fresh copy on every call, so that tests can change it. */
export function exampleKb(): KnowledgeBase {
  const result = loadKb(EXAMPLE_KB);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.kb;
}

/** Answers with the given values in order, checked against the schema like a real provider. */
export class FakeProvider implements LlmProvider {
  readonly requests: LlmRequest<unknown>[] = [];
  readonly #answers: unknown[];

  constructor(...answers: unknown[]) {
    this.#answers = answers;
  }

  generate<T>(request: LlmRequest<T>): Promise<T> {
    this.requests.push(request);
    return Promise.resolve(request.schema.parse(this.#answers.shift()));
  }
}

export function requirement(id: string, kind: "must" | "nice", ...keywords: string[]) {
  return { id, text: keywords.join(" "), kind, keywords };
}

export function analysis(...requirements: JobAnalysis["requirements"]): JobAnalysis {
  return {
    title: "Platform Engineer",
    company: "Esempio SA",
    location: null,
    postingLanguage: "en",
    seniority: "senior",
    requirements,
    languages: [],
  };
}

type Written = [slot: string, text: string, sources: string[]];
type Verdict = "supported" | "partially" | "unsupported";
type Script = {
  draft: Written[] | Error;
  redraft?: Record<string, [text: string, sources: string[]]> | Error;
  judge?: (text: string) => Verdict | Error;
};

/**
 * Plays the drafter, the rewriter and the judge, which supports everything unless told otherwise.
 * Answers skip the schema, so that a test can return what a real provider would have rejected.
 */
export class PipelineProvider implements LlmProvider {
  readonly calls: { role: "draft" | "redraft" | "judge"; request: LlmRequest<unknown> }[] = [];
  readonly #script: Script;

  constructor(script: Script) {
    this.#script = script;
  }

  generate<T>(request: LlmRequest<T>): Promise<T> {
    const role = request.prompt.includes("<sentence")
      ? "judge"
      : request.prompt.includes("<rejected>")
        ? "redraft"
        : "draft";
    this.calls.push({ role, request: request });
    const answer = this.#answer(role, request.prompt);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as T);
  }

  count(role: "draft" | "redraft" | "judge"): number {
    return this.calls.filter((call) => call.role === role).length;
  }

  #answer(role: "draft" | "redraft" | "judge", prompt: string): unknown {
    const { draft, redraft = {}, judge = () => "supported" as const } = this.#script;
    if (role === "draft") {
      if (draft instanceof Error) return draft;
      const sections = draft.map(([slot, text, sources]) => ({
        slot,
        sentences: [{ text, sources, addresses: [] }],
      }));
      return { sections };
    }
    if (role === "redraft") {
      if (redraft instanceof Error) return redraft;
      const claims = Object.entries(redraft).map(([id, [text, sources]]) => ({
        id,
        text,
        sources,
        addresses: [],
      }));
      return { claims };
    }
    const text = /<sentence[^>]*>\n(.*)\n<\/sentence>/s.exec(prompt)?.[1] ?? "";
    const verdict = judge(text);
    return verdict instanceof Error ? verdict : { verdict, reason: `judged ${verdict}` };
  }
}

/** A CV for a posting that asks for Kubernetes and CI/CD, with a stored analysis. */
export function runRequest(db: DatabaseSync, provider: LlmProvider): RunRequest {
  const jobAnalysis = analysis(
    requirement("req-1", "must", "Kubernetes"),
    requirement("req-2", "nice", "CI/CD"),
  );
  const id = saveJobAnalysis(db, { posting: "posting", model: "model", analysis: jobAnalysis });
  return {
    db,
    provider,
    draftModel: "draft-model",
    judgeModel: "judge-model",
    kb: exampleKb(),
    job: { id, analysis: jobAnalysis },
    type: "cv",
    language: "en",
    market: "ch-en",
    asOf: "2026-01-15",
  };
}
