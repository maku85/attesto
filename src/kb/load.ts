import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LineCounter, parseDocument } from "yaml";
import { z } from "zod";
import { KB_FILES, type Issue, type KbSection, type KnowledgeBase } from "./schema.ts";
import { crossCheck } from "./validate.ts";

export type LoadResult = { ok: true; kb: KnowledgeBase } | { ok: false; issues: Issue[] };

/** Flag first, then ATTESTO_KB, then a directory outside any repository. */
export function resolveKbDir(flag?: string): string {
  return flag || process.env.ATTESTO_KB || join(homedir(), ".attesto", "kb");
}

/** The only way to obtain a knowledge base, so that callers never see an invalid one. */
export function loadKb(dir: string): LoadResult {
  const issues: Issue[] = [];
  const sections: Partial<Record<KbSection, unknown>> = {};

  for (const section of Object.keys(KB_FILES) as KbSection[]) {
    const { file, schema } = KB_FILES[section];
    const raw = readYaml(dir, file, issues);
    if (raw === undefined) continue;
    // Only person.yaml is required: a missing or empty list file means no entries.
    const parsed = schema.safeParse(section === "person" ? raw : (raw ?? []));
    if (parsed.success) sections[section] = parsed.data;
    else {
      for (const issue of parsed.error.issues) {
        issues.push({ file, path: z.core.toDotPath(issue.path), message: issue.message });
      }
    }
  }

  issues.push(...unknownFiles(dir));
  if (issues.length > 0) return { ok: false, issues };
  const kb = sections as KnowledgeBase;
  const crossIssues = crossCheck(kb);
  return crossIssues.length > 0 ? { ok: false, issues: crossIssues } : { ok: true, kb };
}

/** Returns `null` for a missing or empty file, and `undefined` after reporting an error. */
function readYaml(dir: string, file: string, issues: Issue[]): unknown {
  let source: string;
  try {
    source = readFileSync(join(dir, file), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (file !== KB_FILES.person.file) return null;
    issues.push({ file, path: "", message: `file not found in ${dir}` });
    return undefined;
  }
  const lineCounter = new LineCounter();
  // prettyErrors quotes the offending source line, which may hold personal data.
  const document = parseDocument(source, { lineCounter, prettyErrors: false });
  if (document.errors.length > 0) {
    for (const error of document.errors) {
      const { line } = lineCounter.linePos(error.pos[0]);
      issues.push({ file, path: `line ${line}`, message: error.message });
    }
    return undefined;
  }
  return document.toJS() as unknown;
}

/** A misnamed file would otherwise be ignored without a word. */
function unknownFiles(dir: string): Issue[] {
  const known = new Set<string>(Object.values(KB_FILES).map(({ file }) => file));
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter((name) => /\.ya?ml$/i.test(name) && !known.has(name))
    .map((file) => ({
      file,
      path: "",
      message: `unknown file; expected one of ${[...known].join(", ")}`,
    }));
}
