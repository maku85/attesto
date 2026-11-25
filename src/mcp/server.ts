import { McpServer, ResourceTemplate, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ENTRY_TYPES, listEntries } from "../kb/entries.ts";
import { loadKb } from "../kb/load.ts";
import type { KnowledgeBase } from "../kb/schema.ts";
import { getEntry, searchKb } from "../kb/search.ts";
import { resolveModel, type LlmProvider } from "../llm/provider.ts";
import { analyzePosting } from "../pipeline/analyze.ts";
import { openDb } from "../store/db.ts";
import { saveJobAnalysis } from "../store/jobs.ts";

export type ServerConfig = {
  kbDir: string;
  dbPath: string;
  /** Called on first use, so that the knowledge-base tools work without an API key. */
  provider: () => LlmProvider;
};

export function createServer({ kbDir, dbPath, provider }: ServerConfig): McpServer {
  const server = new McpServer({ name: "attesto", version: "0.0.0" });
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "kb_search",
    {
      description:
        "Search the career knowledge base. Returns entry IDs with a one-line title; use kb_get " +
        "for the full entry. An empty query lists every entry the filters allow.",
      inputSchema: z.object({
        query: z.string(),
        filters: z
          .object({
            types: z.array(z.enum(ENTRY_TYPES)).optional(),
            skill: z.string().optional().describe("A skill ID, such as skl-kubernetes"),
          })
          .optional(),
      }),
      annotations: readOnly,
    },
    ({ query, filters }) => json(searchKb(readKb(kbDir), query, filters)),
  );

  server.registerTool(
    "kb_get",
    {
      description:
        "Get one knowledge-base entry by ID. Contact details, nationality, work permit and birth " +
        "date are never returned.",
      inputSchema: z.object({ id: z.string() }),
      annotations: readOnly,
    },
    ({ id }) => {
      const entry = getEntry(readKb(kbDir), id);
      if (!entry) throw new Error(`No entry has the ID ${id}`);
      return json(entry);
    },
  );

  server.registerTool(
    "kb_validate",
    {
      description: "Check the knowledge base and list every issue found.",
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    () => {
      const result = loadKb(kbDir);
      return json({ valid: result.ok, issues: result.ok ? [] : result.issues });
    },
  );

  server.registerTool(
    "job_analyze",
    {
      description:
        "Extract requirements, seniority and languages from the text of a job posting. Returns " +
        "the analysis and a jobAnalysisId.",
      inputSchema: z.object({ text: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ text }) => {
      const model = resolveModel();
      const db = openDb(dbPath);
      try {
        const analysis = await analyzePosting(provider(), model, text);
        const jobAnalysisId = saveJobAnalysis(db, { posting: text, model, analysis });
        return json({ jobAnalysisId, analysis });
      } finally {
        db.close();
      }
    },
  );

  server.registerResource(
    "kb-entry",
    new ResourceTemplate("attesto://kb/{id}", {
      list: () => ({
        resources: listEntries(readKb(kbDir)).map(({ id, title }) => ({
          uri: `attesto://kb/${id}`,
          name: id,
          title,
          mimeType: "application/json",
        })),
      }),
    }),
    { description: "Knowledge-base entries, read-only", mimeType: "application/json" },
    (uri, { id }) => {
      const entry = getEntry(readKb(kbDir), String(id));
      if (!entry) throw new Error(`No entry has the ID ${String(id)}`);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(entry) }],
      };
    },
  );

  return server;
}

/** Read on every call, so that edits to the files show up without a restart. */
function readKb(dir: string): KnowledgeBase {
  const result = loadKb(dir);
  if (!result.ok) throw new Error("The knowledge base is not valid; see kb_validate");
  return result.kb;
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
