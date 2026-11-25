import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LlmError, type LlmProvider, type LlmRequest } from "./provider.ts";

const MAX_TOKENS = 16_000;

export class AnthropicProvider implements LlmProvider {
  readonly #client: Anthropic;

  constructor(client: Anthropic = new Anthropic()) {
    this.#client = client;
  }

  async generate<T>({ model, system, prompt, schema }: LlmRequest<T>): Promise<T> {
    const format = zodOutputFormat(schema);
    const message = await this.#client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format, effort: "medium" },
    });
    // Checked before parsing, because an incomplete answer is not valid JSON either.
    if (message.stop_reason !== "end_turn") {
      const category = message.stop_details?.category;
      throw new LlmError(
        `${model} stopped with ${message.stop_reason}${category ? ` (${category})` : ""}`,
      );
    }
    const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    try {
      return format.parse(text);
    } catch (error) {
      throw new LlmError(`${model} returned an answer that does not match the schema`, {
        cause: error,
      });
    }
  }
}
