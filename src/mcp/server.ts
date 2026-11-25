import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  McpServer,
  ResourceTemplate,
  type CallToolResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { ENTRY_TYPES, listEntries } from "../kb/entries.ts";
import { loadKb } from "../kb/load.ts";
import { Lang, type KnowledgeBase } from "../kb/schema.ts";
import { getEntry, searchKb } from "../kb/search.ts";
import { resolveJudgeModel, resolveModel, type LlmProvider } from "../llm/provider.ts";
import {
  MARKETS,
  TONES,
  VerifiableDocument,
  type Document,
  type Tone,
} from "../pipeline/document.ts";
import { analyzeAndStore, produce, storedJob, today } from "../pipeline/produce.ts";
import { changedSources, verifyDocument } from "../pipeline/verify/document.ts";
import { openDb } from "../store/db.ts";
import { getRun } from "../store/runs.ts";

// Resolves to the repository's package.json from both src/mcp and dist/mcp.
const VERSION = z
  .object({ version: z.string() })
  .parse(
    JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8")),
  ).version;

export type ServerConfig = {
  kbDir: string;
  dbPath: string;
  /** Where generated documents are written. */
  outDir: string;
  /** Called on first use, so that the knowledge-base tools work without an API key. */
  provider: () => LlmProvider;
};

export function createServer({ kbDir, dbPath, outDir, provider }: ServerConfig): McpServer {
  const server = new McpServer({ name: "attesto", version: VERSION });
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
      const db = openDb(dbPath);
      try {
        const job = await analyzeAndStore(db, provider(), text);
        return json({ jobAnalysisId: job.id, analysis: job.analysis });
      } finally {
        db.close();
      }
    },
  );

  const jobInput = {
    jobText: z.string().optional().describe("The text of the posting"),
    jobAnalysisId: z.string().optional().describe("From job_analyze, instead of jobText"),
    language: Lang,
    market: z.enum(MARKETS),
  };
  const oneJob = {
    check: (input: JobInput) =>
      (input.jobText === undefined) !== (input.jobAnalysisId === undefined),
    error: "Give either jobText or jobAnalysisId",
  };
  const generated =
    "Writes the document as Markdown and HTML with a provenance report to local files, and returns " +
    "their paths, the verified claims and the rejected ones. Contact details stay in the files.";
  const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

  const generate = async (
    type: Document["type"],
    { jobText, jobAnalysisId, language, market, tone }: JobInput & { tone?: Tone },
    context: ServerContext,
  ) => {
    const kb = readKb(kbDir);
    const onProgress = progressReporter(context);
    const db = openDb(dbPath);
    try {
      if (jobText !== undefined) onProgress("Analyzing the posting");
      const job =
        jobText !== undefined
          ? await analyzeAndStore(db, provider(), jobText)
          : storedJob(db, jobAnalysisId ?? "");
      const { document, verifications, files } = await produce({
        db,
        provider: provider(),
        draftModel: resolveModel(),
        judgeModel: resolveJudgeModel(),
        kb,
        job,
        type,
        language,
        market,
        tone,
        asOf: today(),
        outDir,
        onProgress,
      });
      const rejected = verifications.filter(({ decision }) => decision !== "accepted");
      return json({ runId: document.runId, files, sections: document.sections, rejected });
    } finally {
      db.close();
    }
  };

  server.registerTool(
    "cv_generate",
    {
      description: `Generate a CV tailored to a job posting. ${generated}`,
      inputSchema: z.object(jobInput).refine(oneJob.check, { error: oneJob.error }),
      annotations: writes,
    },
    (input, context) => generate("cv", input, context),
  );

  server.registerTool(
    "letter_generate",
    {
      description: `Generate a cover letter tailored to a job posting. ${generated}`,
      inputSchema: z
        .object({ ...jobInput, tone: z.enum(TONES).optional() })
        .refine(oneJob.check, { error: oneJob.error }),
      annotations: writes,
    },
    (input, context) => generate("letter", input, context),
  );

  server.registerTool(
    "document_verify",
    {
      description:
        "Verify every claim of an attesto document (JSON) against the knowledge base: structure, " +
        "numbers and whether the cited entries support it.",
      inputSchema: z.object({ document: VerifiableDocument }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ document }) =>
      json(await verifyDocument(document, readKb(kbDir), provider(), resolveJudgeModel())),
  );

  server.registerTool(
    "run_get",
    {
      description:
        "Get a past run with its document, the decision on every claim, and the entries that have " +
        "changed since.",
      inputSchema: z.object({ runId: z.string() }),
      annotations: readOnly,
    },
    ({ runId }) => {
      const db = openDb(dbPath);
      try {
        const run = getRun(db, runId);
        if (!run) throw new Error(`No run has the ID ${runId}`);
        return json({
          ...run,
          changedSources: changedSources(run.sources, readKb(kbDir), run.asOf),
        });
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

type JobInput = {
  jobText?: string;
  jobAnalysisId?: string;
  language: Lang;
  market: Document["market"];
};

/** Generation takes minutes; progress tells the client that the request is still alive. */
function progressReporter({ mcpReq }: ServerContext): (step: string) => void {
  const progressToken = mcpReq._meta?.progressToken;
  let progress = 0;
  return (message) => {
    if (progressToken === undefined) return;
    progress += 1;
    mcpReq
      .notify({ method: "notifications/progress", params: { progressToken, progress, message } })
      // A client that has gone away must not fail the run.
      .catch(() => undefined);
  };
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
