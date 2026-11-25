import { join } from "node:path";
import { loadKb } from "../src/kb/load.ts";
import type { KnowledgeBase } from "../src/kb/schema.ts";
import type { LlmProvider, LlmRequest } from "../src/llm/provider.ts";
import type { JobAnalysis } from "../src/pipeline/analyze.ts";

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
