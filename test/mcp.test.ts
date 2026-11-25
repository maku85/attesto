import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LlmProvider } from "../src/llm/provider.ts";
import { createServer } from "../src/mcp/server.ts";
import { openDb } from "../src/store/db.ts";
import { EXAMPLE_KB, FakeProvider, ROOT, analysis } from "./fixtures.ts";

let dir: string;
let dbPath: string;
let client: Client;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attesto-mcp-"));
  dbPath = join(dir, "attesto.db");
  client = new Client({ name: "test", version: "0.0.0" });
});
afterEach(async () => {
  await client.close();
  rmSync(dir, { recursive: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const [block] = result.content;
  const text = block?.type === "text" ? block.text : "";
  return { isError: result.isError === true, text };
}

describe("in process", () => {
  async function connect(kbDir: string, provider: () => LlmProvider) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer({ kbDir, dbPath, provider }).connect(serverSide);
    await client.connect(clientSide);
  }
  const noProvider = () => {
    throw new Error("the provider must not be created");
  };

  it("analyzes a posting and stores the analysis", async () => {
    const provider = new FakeProvider({
      ...analysis(),
      requirements: [{ text: "Kubernetes", kind: "must", keywords: ["Kubernetes"] }],
    });
    await connect(EXAMPLE_KB, () => provider);
    const { isError, text } = await call("job_analyze", { text: "We look for…" });
    expect(isError).toBe(false);
    const { jobAnalysisId, analysis: returned } = JSON.parse(text) as {
      jobAnalysisId: string;
      analysis: unknown;
    };

    const db = openDb(dbPath);
    const row = db.prepare("SELECT id, posting, analysis FROM job_analyses").get();
    db.close();
    expect(row).toMatchObject({ id: jobAnalysisId, posting: "We look for…" });
    expect(JSON.parse(row?.analysis as string)).toEqual(returned);
  });

  it("stores nothing when the analysis fails", async () => {
    await connect(EXAMPLE_KB, () => new FakeProvider({}));
    expect((await call("job_analyze", { text: "We look for…" })).isError).toBe(true);
    const db = openDb(dbPath);
    expect(db.prepare("SELECT * FROM job_analyses").all()).toEqual([]);
    db.close();
  });

  it("serves the knowledge base without an LLM", async () => {
    await connect(EXAMPLE_KB, noProvider);
    const search = await call("kb_search", { query: "kafka", filters: { types: ["skill"] } });
    expect(JSON.parse(search.text)).toMatchObject([{ id: "skl-kafka" }]);
    const entry = await call("kb_get", { id: "exp-lagonube-2022" });
    expect(JSON.parse(entry.text)).toMatchObject({ company: "LagoNube SA" });
    const validation = await call("kb_validate");
    expect(JSON.parse(validation.text)).toEqual({ valid: true, issues: [] });
  });

  it("reports errors as tool results", async () => {
    await connect(join(dir, "missing"), noProvider);
    expect(JSON.parse((await call("kb_validate")).text)).toMatchObject({ valid: false });
    const search = await call("kb_search", { query: "kafka" });
    expect(search).toMatchObject({ isError: true });
    expect(search.text).toContain("kb_validate");
  });

  it("offers every entry as a resource, without private fields", async () => {
    await connect(EXAMPLE_KB, noProvider);
    const { resources } = await client.listResources();
    expect(resources).toHaveLength(40);
    let all = "";
    for (const { uri } of resources) {
      const { contents } = await client.readResource({ uri });
      all += JSON.stringify(contents);
    }
    expect(all).toContain("LagoNube SA");
    expect(all).not.toMatch(/giulia@example|1990-04-12|Permesso|nationality/);
    await expect(client.readResource({ uri: "attesto://kb/ach-nope" })).rejects.toThrow();
  });
});

it("speaks MCP over stdio through the CLI", async () => {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(ROOT, "src/cli/main.ts"), "mcp", "--kb", EXAMPLE_KB],
      env: { ATTESTO_DB: dbPath },
      stderr: "ignore",
    }),
  );
  const { tools } = await client.listTools();
  expect(tools.map(({ name }) => name).sort()).toEqual([
    "job_analyze",
    "kb_get",
    "kb_search",
    "kb_validate",
  ]);
  expect(JSON.parse((await call("kb_get", { id: "ach-cantiere-ci" })).text)).toMatchObject({
    ownerId: "exp-cantiere-2017",
  });
});
