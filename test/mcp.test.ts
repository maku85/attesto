import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LlmProvider } from "../src/llm/provider.ts";
import { generateDocument } from "../src/pipeline/run.ts";
import { createServer } from "../src/mcp/server.ts";
import { openDb } from "../src/store/db.ts";
import {
  EXAMPLE_KB,
  FakeProvider,
  PipelineProvider,
  ROOT,
  analysis,
  runRequest,
} from "./fixtures.ts";

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
    await createServer({ kbDir, dbPath, outDir: join(dir, "out"), provider }).connect(serverSide);
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

  it("verifies a document, and returns a stored run", async () => {
    const provider = new PipelineProvider({
      draft: [["letter-body", "Reduced the median deployment time.", ["ach-lagonube-deploy-time"]]],
    });
    await connect(EXAMPLE_KB, () => provider);
    const db = openDb(dbPath);
    const { document } = await generateDocument({
      ...runRequest(db, provider),
      type: "letter",
    });
    db.close();

    const verified = await call("document_verify", { document });
    expect(JSON.parse(verified.text)).toMatchObject({ supported: true, changedSources: [] });
    const stored = await call("run_get", { runId: document.runId });
    expect(JSON.parse(stored.text)).toMatchObject({
      status: "completed",
      document,
      verifications: [{ decision: "accepted" }],
      changedSources: [],
    });
    expect(await call("run_get", { runId: "nope" })).toMatchObject({ isError: true });
    expect(await call("document_verify", { document: { sections: [] } })).toMatchObject({
      isError: true,
    });
  });

  it("generates a document from a stored analysis, with progress", async () => {
    const provider = new PipelineProvider({
      draft: [
        ["letter-body", "Reduced the median deployment time.", ["ach-lagonube-deploy-time"]],
        ["letter-body", "Cut costs by 90%.", ["ach-lagonube-cloud-cost"]],
      ],
    });
    await connect(EXAMPLE_KB, () => provider);
    const db = openDb(dbPath);
    const { job } = runRequest(db, provider);
    db.close();

    const steps: (string | undefined)[] = [];
    const args = { jobAnalysisId: job.id, language: "it", market: "ch-it", tone: "formal" };
    const result = await client.callTool(
      { name: "letter_generate", arguments: args },
      { onprogress: ({ message }) => steps.push(message) },
    );
    const block = result.content[0];
    const text = block?.type === "text" ? block.text : "";
    expect(JSON.parse(text)).toMatchObject({
      sections: [
        { slot: "letter-body", claims: [{ text: "Reduced the median deployment time." }] },
      ],
      rejected: [{ text: "Cut costs by 90%.", decision: "dropped" }],
    });
    expect(steps).toContain("Drafting");
    // Personal details are in the files, not in the answer.
    expect(text).not.toMatch(/giulia@|\+41|Permesso/);
    const [file] = (JSON.parse(text) as { files: string[] }).files;
    expect(readFileSync(file!, "utf8")).toContain("giulia@example.com");
  });

  it.each([
    ["cv_generate", {}],
    ["cv_generate", { jobText: "x", jobAnalysisId: "y" }],
    ["letter_generate", { jobAnalysisId: "nope" }],
    ["letter_generate", { jobAnalysisId: "nope", tone: "pushy" }],
  ])("%s rejects %j", async (name, args) => {
    await connect(EXAMPLE_KB, () => new FakeProvider());
    expect(await call(name, { language: "en", market: "ch-en", ...args })).toMatchObject({
      isError: true,
    });
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
    "cv_generate",
    "document_verify",
    "job_analyze",
    "kb_get",
    "kb_search",
    "kb_validate",
    "letter_generate",
    "run_get",
  ]);
  expect(JSON.parse((await call("kb_get", { id: "ach-cantiere-ci" })).text)).toMatchObject({
    ownerId: "exp-cantiere-2017",
  });
});
