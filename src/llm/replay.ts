import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { LlmError, type LlmProvider, type LlmRequest } from "./provider.ts";

type Recording = { key: string } & ({ answer: unknown } | { error: string });

/**
 * Answers from a file of recorded answers. Given a live provider, it asks that one for whatever is
 * missing and records the answer at once, so that an interrupted run continues where it stopped.
 */
export class ReplayProvider implements LlmProvider {
  readonly #path: string;
  readonly #live: LlmProvider | undefined;
  readonly #recorded = new Map<string, Recording[]>();
  readonly #asked = new Map<string, number>();

  constructor(path: string, live?: LlmProvider) {
    this.#path = path;
    this.#live = live;
    const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
    for (const line of lines.filter((text) => text !== "")) {
      const recording = JSON.parse(line) as Recording;
      this.#recorded.set(recording.key, [...(this.#recorded.get(recording.key) ?? []), recording]);
    }
  }

  async generate<T>(request: LlmRequest<T>): Promise<T> {
    const key = keyOf(request);
    // The same request asked again is a repetition, with an answer of its own.
    const turn = this.#asked.get(key) ?? 0;
    this.#asked.set(key, turn + 1);
    const recording = this.#recorded.get(key)?.[turn] ?? (await this.#record(key, request));
    if ("error" in recording) throw new LlmError(recording.error);
    return request.schema.parse(recording.answer);
  }

  async #record<T>(key: string, request: LlmRequest<T>): Promise<Recording> {
    if (!this.#live) {
      throw new Error(
        "A prompt, schema or example has changed since the answers were recorded, or they never " +
          "were. Run: attesto eval --live",
      );
    }
    let recording: Recording;
    try {
      recording = { key, answer: await this.#live.generate(request) };
    } catch (error) {
      // A refusal is an answer too. Anything else, such as a lost connection, is not.
      if (!(error instanceof LlmError)) throw error;
      recording = { key, error: error.message };
    }
    appendFileSync(this.#path, JSON.stringify(recording) + "\n");
    return recording;
  }
}

function keyOf<T>({ model, system, prompt, schema }: LlmRequest<T>): string {
  return createHash("sha256")
    .update(JSON.stringify([model, system, prompt, z.toJSONSchema(schema)]))
    .digest("hex");
}
