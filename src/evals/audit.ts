import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { z } from "zod";
import type { KnowledgeBase } from "../kb/schema.ts";
import { listSources } from "../kb/sources.ts";
import type { Verification } from "../pipeline/document.ts";
import { AUDIT_KEY, AUDIT_SAMPLE, EVAL_DATE } from "./paths.ts";
import type { PostingResult } from "./postings.ts";
import type { Count } from "./stats.ts";

const SAMPLE_PER_GROUP = 50;

const Sample = z.array(z.object({ id: z.string(), supported: z.boolean().nullable() }));
const Key = z.record(z.string(), z.boolean());
export type AuditSummary = { wronglyAccepted: Count; wronglyRejected: Count; unlabelled: number };

const INSTRUCTIONS = ` Does the sentence follow from the facts of its sources, and from nothing else?
 Set "supported" to true or false. The verdict of the verifier is in another file: do not look.`;

/**
 * Draws claims that the judge decided on, for a person to label without seeing the verdict. The order
 * depends on the text only, so it gives nothing away. Never overwrites a sample.
 */
export function writeAuditSample(
  results: PostingResult[],
  kb: KnowledgeBase,
  paths = { sample: AUDIT_SAMPLE, key: AUDIT_KEY },
): number {
  if (existsSync(paths.sample)) throw new Error(`${paths.sample} already exists`);
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const judged = results.flatMap((result) =>
    "run" in result
      ? result.run.verifications
          .filter(({ entailment }) => entailment !== null)
          .map((verification) => ({
            verification,
            language: result.run.document.language,
            id: hash(`${verification.text}${verification.sources.join()}`).slice(0, 12),
          }))
      : [],
  );
  const unique = [...new Map(judged.map((item) => [item.id, item])).values()].sort((a, b) =>
    a.id < b.id ? -1 : 1,
  );
  const isAccepted = ({ decision }: Verification) => decision === "accepted";
  const pick = (accepted: boolean) =>
    unique
      .filter(({ verification }) => isAccepted(verification) === accepted)
      .slice(0, SAMPLE_PER_GROUP);
  const sample = [...pick(true), ...pick(false)].sort((a, b) => (a.id < b.id ? -1 : 1));

  const facts = new Map(
    listSources(kb, EVAL_DATE, kb.person.defaultLanguage).map((source) => [
      source.id,
      source.facts,
    ]),
  );
  const items = sample.map(({ id, language, verification: { text, sources } }) => ({
    id,
    language,
    text,
    sources: Object.fromEntries(sources.map((source) => [source, facts.get(source) ?? []])),
    supported: null,
  }));
  const comment = INSTRUCTIONS.replace(/^/gm, "#");
  writeFileSync(paths.sample, `${comment}\n${stringify(items)}`, { flag: "wx" });
  const key = Object.fromEntries(
    sample.map(({ id, verification }) => [id, isAccepted(verification)]),
  );
  writeFileSync(paths.key, JSON.stringify(key, null, 2) + "\n");
  return items.length;
}

export function readAudit(
  paths = { sample: AUDIT_SAMPLE, key: AUDIT_KEY },
): AuditSummary | undefined {
  if (!existsSync(paths.sample)) return undefined;
  const sample = Sample.parse(parse(readFileSync(paths.sample, "utf8")));
  const key = Key.parse(JSON.parse(readFileSync(paths.key, "utf8")));
  const labelled = sample.filter(({ supported }) => supported !== null);
  const among = (accepted: boolean): Count => {
    const group = labelled.filter(({ id }) => key[id] === accepted);
    return {
      hits: group.filter(({ supported }) => supported !== accepted).length,
      of: group.length,
    };
  };
  return {
    wronglyAccepted: among(true),
    wronglyRejected: among(false),
    unlabelled: sample.length - labelled.length,
  };
}
