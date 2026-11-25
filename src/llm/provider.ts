import type { z } from "zod";

export type LlmRequest<T> = {
  model: string;
  system: string;
  prompt: string;
  /** The response must match this schema; a provider never returns anything else. */
  schema: z.ZodType<T>;
};

export interface LlmProvider {
  generate<T>(request: LlmRequest<T>): Promise<T>;
}

export class LlmError extends Error {}

export function resolveModel(): string {
  return process.env.ATTESTO_MODEL || "claude-opus-5-5";
}

/** Separate, so that the judge does not have to be the model that wrote the text. */
export function resolveJudgeModel(): string {
  return process.env.ATTESTO_JUDGE_MODEL || resolveModel();
}
