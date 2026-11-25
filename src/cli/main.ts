#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadKb, resolveKbDir } from "../kb/load.ts";

const USAGE = `Usage:
  attesto validate [--kb <dir>]

The knowledge base directory is --kb, else $ATTESTO_KB, else ~/.attesto/kb.`;

function validate(args: string[]): number {
  const { values } = parseArgs({ args, options: { kb: { type: "string" } } });
  const dir = resolveKbDir(values.kb);
  const result = loadKb(dir);
  if (!result.ok) {
    for (const { file, path, message } of result.issues) {
      console.error(`${file}${path && ` (${path})`}: ${message}`);
    }
    console.error(`\n${result.issues.length} issue(s) in ${dir}`);
    return 1;
  }
  const { kb } = result;
  const achievements = [...kb.experiences, ...kb.projects].flatMap((owner) => owner.achievements);
  console.log(
    `Valid: ${kb.experiences.length} experiences, ${kb.projects.length} projects, ` +
      `${achievements.length} achievements, ${kb.skills.length} skills`,
  );
  return 0;
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "validate") process.exitCode = validate(args);
  else if (command === "--help" || command === "-h") console.log(USAGE);
  else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
