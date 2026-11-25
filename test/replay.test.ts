import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { LlmError, type LlmProvider } from "../src/llm/provider.ts";
import { ReplayProvider } from "../src/llm/replay.ts";
import { FakeProvider } from "./fixtures.ts";

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attesto-replay-"));
  path = join(dir, "recordings.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true }));

const request = (prompt = "p", schema: z.ZodType = z.string()) => ({
  model: "m",
  system: "s",
  prompt,
  schema,
});

it("records live answers and replays them without a live provider", async () => {
  const live = new ReplayProvider(path, new FakeProvider("one", "two"));
  expect(await live.generate(request("a"))).toBe("one");
  expect(await live.generate(request("b"))).toBe("two");
  const replay = new ReplayProvider(path);
  expect(await replay.generate(request("b"))).toBe("two");
  expect(await replay.generate(request("a"))).toBe("one");
});

it("keeps repetitions of one request apart", async () => {
  const live = new ReplayProvider(path, new FakeProvider("first", "second"));
  await live.generate(request());
  await live.generate(request());
  const replay = new ReplayProvider(path);
  expect([await replay.generate(request()), await replay.generate(request())]).toEqual([
    "first",
    "second",
  ]);
  await expect(replay.generate(request())).rejects.toThrow("attesto eval --live");
});

it("asks the live provider only for what is missing", async () => {
  await new ReplayProvider(path, new FakeProvider("one")).generate(request("a"));
  const fake = new FakeProvider("new");
  const resumed = new ReplayProvider(path, fake);
  await resumed.generate(request("a"));
  await resumed.generate(request("b"));
  expect(fake.requests.map(({ prompt }) => prompt)).toEqual(["b"]);
});

it.each([
  ["prompt", request("other")],
  ["schema", request("p", z.union([z.string(), z.number()]))],
  ["model", { ...request(), model: "n" }],
  ["system prompt", { ...request(), system: "t" }],
])("does not replay an answer to another %s", async (_, other) => {
  await new ReplayProvider(path, new FakeProvider("one")).generate(request());
  await expect(new ReplayProvider(path).generate(other)).rejects.toThrow("has changed");
});

it("replays a refusal, but does not record a lost connection", async () => {
  const failing = (error: Error): LlmProvider => ({ generate: () => Promise.reject(error) });
  await expect(
    new ReplayProvider(path, failing(new LlmError("refusal"))).generate(request("a")),
  ).rejects.toThrow(LlmError);
  await expect(new ReplayProvider(path).generate(request("a"))).rejects.toThrow(LlmError);
  await expect(
    new ReplayProvider(path, failing(new Error("offline"))).generate(request("b")),
  ).rejects.toThrow("offline");
  expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
});
