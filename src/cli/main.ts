#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ENTRY_TYPES } from "../kb/entries.ts";
import { writeAuditSample } from "../evals/audit.ts";
import { AUDIT_SAMPLE, EXAMPLE_KB, README, RECORDINGS, RESULTS } from "../evals/paths.ts";
import { fullReport, summaryTable, updateReadme } from "../evals/report.ts";
import { runEval } from "../evals/run.ts";
import { loadKb, resolveKbDir } from "../kb/load.ts";
import { LANGS, type KnowledgeBase } from "../kb/schema.ts";
import { getEntry, searchKb } from "../kb/search.ts";
import { AnthropicProvider } from "../llm/anthropic.ts";
import { resolveJudgeModel, resolveModel } from "../llm/provider.ts";
import { ReplayProvider } from "../llm/replay.ts";
import { createServer } from "../mcp/server.ts";
import { DOCUMENT_TYPES, MARKETS, TONES, VerifiableDocument } from "../pipeline/document.ts";
import { analyzeAndStore, produce, today } from "../pipeline/produce.ts";
import { verifyDocument } from "../pipeline/verify/document.ts";
import { openDb, resolveDbPath } from "../store/db.ts";
import { getRun, listRuns } from "../store/runs.ts";
import { z } from "zod";

// Resolves to the repository's templates/ from both src/cli and dist/cli.
const KB_TEMPLATE = join(import.meta.dirname, "..", "..", "templates", "kb");

const USAGE = `Usage:
  attesto init [--kb <dir>]
  attesto validate [--kb <dir>]
  attesto search <query> [--type <type>]... [--skill <id>] [--kb <dir>]
  attesto get <id> [--kb <dir>]
  attesto analyze <posting.txt>
  attesto generate --job <posting.txt> --type cv|letter --lang it|en|de
      --market ch-it|ch-en|ch-de [--out <dir>] [--tone formal|warm|direct]
      [--photo] [--no-regenerate] [--kb <dir>]
  attesto verify <document.json> [--kb <dir>]
  attesto eval [--live] [--only seeded|postings] [--repeat <n>] [--audit]
  attesto runs list
  attesto runs show <id>
  attesto mcp [--kb <dir>]

eval replays recorded answers; with --live it pays for the ones that are missing. --audit draws claims
for a person to label.
Documents are written to --out, else ./out. The MCP server writes to $ATTESTO_OUT, else
~/.attesto/out.
The knowledge base directory is --kb, else $ATTESTO_KB, else ~/.attesto/kb.
Job analyses and runs are stored in $ATTESTO_DB, else ~/.attesto/attesto.db.
The model is $ATTESTO_MODEL, else claude-opus-5-5. The judge is $ATTESTO_JUDGE_MODEL, else the model.`;

/** Wrong usage, reported together with the usage text. */
class UsageError extends Error {}

const kbOption = { kb: { type: "string" } } as const;

function init(args: string[]): void {
  const { values } = parseArgs({ args, options: kbOption });
  const dir = resolveKbDir(values.kb);
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} is not empty`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  cpSync(KB_TEMPLATE, dir, { recursive: true });
  console.log(`Created ${dir}. Edit the files, then run: attesto validate`);
}

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
  const types = values.type?.map((type) => oneOf("--type", type, ENTRY_TYPES));
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
  const db = openDb(resolveDbPath());
  try {
    const job = await analyzeAndStore(db, new AnthropicProvider(), posting);
    printJson({ jobAnalysisId: job.id, analysis: job.analysis });
  } finally {
    db.close();
  }
}

async function generate(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      ...kbOption,
      job: { type: "string" },
      type: { type: "string" },
      lang: { type: "string" },
      market: { type: "string" },
      out: { type: "string", default: "out" },
      tone: { type: "string" },
      photo: { type: "boolean", default: false },
      "no-regenerate": { type: "boolean", default: false },
    },
  });
  const type = oneOf("--type", values.type, DOCUMENT_TYPES);
  const language = oneOf("--lang", values.lang, LANGS);
  const market = oneOf("--market", values.market, MARKETS);
  const tone = values.tone === undefined ? undefined : oneOf("--tone", values.tone, TONES);
  if (!values.job) throw new UsageError("Expected --job");
  if (tone && type === "cv") throw new UsageError("--tone applies to letters");
  if (values.photo && type === "letter") throw new UsageError("--photo applies to CVs");
  const posting = readFileSync(values.job, "utf8");
  const kb = requireKb(values.kb);
  const provider = new AnthropicProvider();
  const onProgress = (step: string) => console.error(`${step}…`);

  const db = openDb(resolveDbPath());
  try {
    onProgress("Analyzing the posting");
    const job = await analyzeAndStore(db, provider, posting);
    const { document, verifications, files } = await produce({
      db,
      provider,
      draftModel: resolveModel(),
      judgeModel: resolveJudgeModel(),
      kb,
      job,
      type,
      language,
      market,
      tone,
      asOf: today(),
      regenerate: !values["no-regenerate"],
      outDir: values.out,
      photo: values.photo,
      onProgress,
    });
    const count = (decision: string) =>
      verifications.filter((verification) => verification.decision === decision).length;
    console.error(
      `Run ${document.runId}: ${count("accepted")} claims accepted, ${count("dropped")} dropped`,
    );
    for (const file of files) console.log(file);
  } finally {
    db.close();
  }
}

async function verify(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: kbOption });
  const file = onlyArgument(positionals, "a document file");
  const parsed = VerifiableDocument.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new Error(`${file} is not an attesto document:\n${z.prettifyError(parsed.error)}`);
  }
  const kb = requireKb(values.kb);
  const report = await verifyDocument(
    parsed.data,
    kb,
    new AnthropicProvider(),
    resolveJudgeModel(),
  );
  printJson(report);
  if (!report.supported) process.exitCode = 1;
}

async function evaluate(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      live: { type: "boolean", default: false },
      only: { type: "string" },
      repeat: { type: "string", default: "3" },
      audit: { type: "boolean", default: false },
    },
  });
  const only =
    values.only === undefined ? undefined : oneOf("--only", values.only, ["seeded", "postings"]);
  const repeat = Number(values.repeat);
  if (!Number.isInteger(repeat) || repeat < 1)
    throw new UsageError("Expected --repeat to be 1 or more");
  if (values.audit && existsSync(AUDIT_SAMPLE)) throw new Error(`${AUDIT_SAMPLE} already exists`);
  // Kept apart from the runs about a real person.
  const db = openDb(join(dirname(resolveDbPath()), "evals.db"));
  try {
    const report = await runEval({
      db,
      provider: new ReplayProvider(RECORDINGS, values.live ? new AnthropicProvider() : undefined),
      mode: values.live ? "live" : "replay",
      draftModel: resolveModel(),
      judgeModel: resolveJudgeModel(),
      repeat,
      only,
      date: today(),
      onProgress: (step) => console.error(`${step}…`),
    });
    if (values.audit) {
      const kb = requireKb(EXAMPLE_KB);
      console.error(`${writeAuditSample(report.postings, kb)} claims to label in ${AUDIT_SAMPLE}`);
    }
    console.log(only ? fullReport(report) : summaryTable(report));
    // A partial run must not replace the published results.
    if (!only) {
      writeFileSync(RESULTS, fullReport(report));
      writeFileSync(README, updateReadme(readFileSync(README, "utf8"), report));
    }
  } finally {
    db.close();
  }
}

function runs(args: string[]): void {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const [action, ...rest] = positionals;
  if (action !== "list" && action !== "show") throw new UsageError("Expected list or show");
  const id = action === "show" ? onlyArgument(rest, "a run ID") : undefined;
  if (action === "list" && rest.length > 0) throw new UsageError("list takes no arguments");
  const db = openDb(resolveDbPath());
  try {
    if (id === undefined) {
      for (const run of listRuns(db)) {
        console.log(
          [run.id, run.createdAt, run.status, run.type, run.language, run.market].join("  "),
        );
      }
      return;
    }
    const run = getRun(db, id);
    if (!run) throw new Error(`No run has the ID ${id}`);
    printJson(run);
  } finally {
    db.close();
  }
}

function mcp(args: string[]): void {
  const { values } = parseArgs({ args, options: kbOption });
  const config = {
    kbDir: resolveKbDir(values.kb),
    dbPath: resolveDbPath(),
    outDir: process.env.ATTESTO_OUT || join(homedir(), ".attesto", "out"),
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

function oneOf<T extends string>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
): T {
  const match = allowed.find((candidate) => candidate === value);
  if (!match) throw new UsageError(`Expected ${name} to be one of ${allowed.join(", ")}`);
  return match;
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
  init,
  validate,
  search,
  get,
  analyze,
  generate,
  verify,
  eval: evaluate,
  runs,
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
