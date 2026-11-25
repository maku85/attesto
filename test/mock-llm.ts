import { exampleKb } from "./fixtures.ts";
import type { LlmProvider, LlmRequest } from "../src/llm/provider.ts";

/**
 * A deterministic stand-in for every role. It copies sources, adds one invented number per document,
 * and as a judge accepts only literal copies. It exercises the evaluation; it measures nothing.
 */
export class MockLlm implements LlmProvider {
  generate<T>(request: LlmRequest<T>): Promise<T> {
    return Promise.resolve(request.schema.parse(this.#answer(request.prompt)));
  }

  #answer(prompt: string): unknown {
    if (prompt.includes("<sentence")) return this.#judge(prompt);
    if (prompt.includes("<rejected>")) return { claims: [] };
    if (prompt.includes("<slots>")) return this.#draft(prompt);
    return this.#analyze(prompt);
  }

  #judge(prompt: string) {
    const text = /<sentence[^>]*>\n(.*)\n<\/sentence>/s.exec(prompt)?.[1] ?? "";
    const supported = prompt.split("<sentence")[0]?.includes(text);
    return { reason: "literal comparison", verdict: supported ? "supported" : "unsupported" };
  }

  #analyze(posting: string) {
    const names = exampleKb().skills.map(({ name }) =>
      typeof name === "string" ? name : name.en!,
    );
    const keywords = names.filter((name) => posting.includes(name.split(" ").at(-1)!));
    return {
      title: posting.split("\n")[1],
      company: null,
      location: null,
      postingLanguage: "en",
      seniority: "unspecified",
      requirements: [...keywords, "COBOL"].map((word) => ({
        text: word,
        kind: "must",
        keywords: [word],
      })),
      languages: [],
    };
  }

  #draft(prompt: string) {
    const facts = new Map(
      [...prompt.matchAll(/^\[([a-z0-9-]+)\]\n- (.*)$/gm)].map(([, id, fact]) => [id!, fact!]),
    );
    const slots = [...prompt.matchAll(/^([a-z0-9-]+): may cite (.*)$/gm)];
    const sections = slots.map(([, slot, ids]) => ({
      slot,
      sentences: ids!
        .split(", ")
        .filter((id) => id.startsWith("ach-"))
        .map((id) => ({ text: facts.get(id), sources: [id], addresses: ["req-1"] })),
    }));
    sections[0]?.sentences.push({
      text: "Saved 987654 francs.",
      sources: [slots[0]![2]!.split(", ")[0]!],
      addresses: [],
    });
    return { sections };
  }
}
