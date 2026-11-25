import Anthropic from "@anthropic-ai/sdk";
import { expect, it } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "../src/llm/anthropic.ts";

const request = {
  model: "claude-opus-5-5",
  system: "system",
  prompt: "prompt",
  schema: z.object({ kind: z.enum(["a", "b"]), items: z.array(z.string()).min(1) }),
};

/** Runs the real SDK against a canned HTTP response. */
async function generate(message: object) {
  let body: unknown;
  const client = new Anthropic({
    apiKey: "test",
    maxRetries: 0,
    fetch: (_, init) => {
      body = JSON.parse(init?.body as string);
      return Promise.resolve(Response.json({ type: "message", role: "assistant", ...message }));
    },
  });
  const result = await new AnthropicProvider(client).generate(request);
  return { result, body };
}
const text = (value: string) => [{ type: "text", text: value }];

it("sends the schema and returns the validated answer", async () => {
  const { result, body } = await generate({
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "", signature: "" },
      ...text('{"kind":"a","items":["x"]}'),
    ],
  });
  expect(result).toEqual({ kind: "a", items: ["x"] });
  expect(body).toMatchObject({
    model: "claude-opus-5-5",
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: {
          additionalProperties: false,
          properties: { kind: { enum: ["a", "b"] }, items: { minItems: 1 } },
        },
      },
    },
  });
});

it.each([
  [
    "a refusal",
    { stop_reason: "refusal", stop_details: { category: "cyber" } },
    /refusal \(cyber\)/,
  ],
  ["a truncated answer", { stop_reason: "max_tokens", content: text('{"kind":') }, /max_tokens/],
  ["broken JSON", { stop_reason: "end_turn", content: text("{") }, /does not match/],
  [
    "a schema violation",
    { stop_reason: "end_turn", content: text('{"kind":"a","items":[]}') },
    /does not match/,
  ],
])("rejects %s", async (_, message, error) => {
  await expect(generate({ content: [], ...message })).rejects.toThrow(error);
});
