#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ENTRY_TYPES, type EntryType } from "../kb/entries.ts";
import { loadKb, resolveKbDir } from "../kb/load.ts";
import type { KnowledgeBase } from "../kb/schema.ts";
import { getEntry, searchKb } from "../kb/search.ts";
import { AnthropicProvider } from "../llm/anthropic.ts";
import { resolveModel } from "../llm/provider.ts";
import { createServer } from "../mcp/server.ts";
import { analyzePosting } from "../pipeline/analyze.ts";
import { openDb, resolveDbPath } from "../store/db.ts";
import { saveJobAnalysis } from "../store/jobs.ts";

const USAGE = `Usage:
  attesto validate [--kb <dir>]
  attesto search <query> [--type <type>]... [--skill <id>] [--kb <dir>]
  attesto get <id> [--kb <dir>]
  attesto analyze <posting.txt>
  attesto mcp [--kb <dir>]

The knowledge base directory is --kb, else $ATTESTO_KB, else ~/.attesto/kb.
Job analyses are stored in $ATTESTO_DB, else ~/.attesto/attesto.db.
The model is $ATTESTO_MODEL, else claude-opus-5-5.`;

/** Wrong usage, reported together with the usage text. */
class UsageError extends Error {}

const kbOption = { kb: { type: "string" } } as const;

function validate(args: string[]): void {
  const { values } = parseArgs({ args, options: kbOption });
  const kb = requireKb(values.kb);
  const achievements = [...kb.experiences, ...kb.projects].flatMap((owner) => owner.achievements);
  console.log(
    `Valid: ${kb.experiences.length} experiences, ${kb.projects.length} projects, ` +
      `${achievements.length} achievements, ${kb.skills.length} skills`,
  );
}

function search(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      ...kbOption,
      type: { type: "string", multiple: true },
      skill: { type: "string" },
    },
  });
  const types = values.type?.map((type) => {
    if (!(ENTRY_TYPES as readonly string[]).includes(type)) {
      throw new UsageError(`Unknown type ${type}; expected one of ${ENTRY_TYPES.join(", ")}`);
    }
    return type as EntryType;
  });
  const hits = searchKb(requireKb(values.kb), positionals.join(" "), {
    types,
    skill: values.skill,
  });
  for (const { id, score, title } of hits) console.log(`${score.toFixed(2)}  ${id}  ${title}`);
}

function get(args: string[]): void {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: kbOption });
  const id = onlyArgument(positionals, "an entry ID");
  const entry = getEntry(requireKb(values.kb), id);
  if (!entry) throw new Error(`No entry has the ID ${id}`);
  printJson(entry);
}

async function analyze(args: string[]): Promise<void> {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const posting = readFileSync(onlyArgument(positionals, "a posting file"), "utf8");
  const model = resolveModel();
  const db = openDb(resolveDbPath());
  try {
    const analysis = await analyzePosting(new AnthropicProvider(), model, posting);
    const jobAnalysisId = saveJobAnalysis(db, { posting, model, analysis });
    printJson({ jobAnalysisId, analysis });
  } finally {
    db.close();
  }
}

function mcp(args: string[]): void {
  const { values } = parseArgs({ args, options: kbOption });
  const config = {
    kbDir: resolveKbDir(values.kb),
    dbPath: resolveDbPath(),
    provider: () => new AnthropicProvider(),
  };
  serveStdio(() => createServer(config), { onerror: (error) => console.error(error.message) });
}

function requireKb(flag: string | undefined): KnowledgeBase {
  const dir = resolveKbDir(flag);
  const result = loadKb(dir);
  if (result.ok) return result.kb;
  const lines = result.issues.map(
    ({ file, path, message }) => `${file}${path && ` (${path})`}: ${message}`,
  );
  throw new Error([...lines, "", `${lines.length} issue(s) in ${dir}`].join("\n"));
}

function onlyArgument(positionals: string[], what: string): string {
  const [value] = positionals;
  if (!value || positionals.length > 1) throw new UsageError(`Expected ${what}`);
  return value;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

const COMMANDS: Record<string, (args: string[]) => void | Promise<void>> = {
  validate,
  search,
  get,
  analyze,
  mcp,
};

const [name = "", ...args] = process.argv.slice(2);
try {
  if (name === "--help" || name === "-h") console.log(USAGE);
  else {
    const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
    if (!command) throw new UsageError(name ? `Unknown command ${name}` : "Expected a command");
    await command(args);
  }
} catch (error) {
  const isUsageError =
    error instanceof UsageError ||
    (error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS") === true;
  console.error(error instanceof Error ? error.message : error);
  if (isUsageError) console.error(`\n${USAGE}`);
  process.exitCode = isUsageError ? 2 : 1;
}
