import { listEntries, type Entry, type EntryType } from "../kb/entries.ts";
import type { KnowledgeBase } from "../kb/schema.ts";
import { compareIds } from "../kb/search.ts";
import { containsPhrase, tokenize } from "../kb/tokens.ts";
import type { JobAnalysis } from "./analyze.ts";

const WEIGHT = { must: 2, nice: 1 };
/** A keyword in the entry's text is weaker evidence than a skill the entry is linked to. */
const TEXT_MATCH = 0.5;
/** Relevance lost per year since the fact, down to a floor. */
const YEARLY_DECAY = 0.05;
const RECENCY_FLOOR = 0.5;

/** The person is rendered by templates, and statements answer no requirement. */
const NOT_SCORED: EntryType[] = ["person", "statement"];

export type ScoredEntry = {
  id: string;
  type: EntryType;
  score: number;
  /** The requirements this entry speaks to. */
  requirements: string[];
};

export type RetrieveOptions = {
  /** The day to measure recency from, as YYYY-MM-DD. */
  asOf: string;
  limitPerType?: number;
};

/** Selects the entries that match the posting. Deterministic: same input, same ranking. */
export function retrieve(
  kb: KnowledgeBase,
  analysis: JobAnalysis,
  { asOf, limitPerType = 12 }: RetrieveOptions,
): ScoredEntry[] {
  const entries = listEntries(kb).filter(({ type }) => !NOT_SCORED.includes(type));
  const requirements = analysis.requirements.map(({ id, kind, keywords }) => {
    const phrases = keywords.map(tokenize).filter((phrase) => phrase.length > 0);
    return { id, weight: WEIGHT[kind], phrases, skills: matchingSkills(entries, phrases) };
  });

  const scored: ScoredEntry[] = [];
  for (const entry of entries) {
    let relevance = 0;
    const matched: string[] = [];
    for (const { id, weight, phrases, skills } of requirements) {
      const match = entry.skills.some((skill) => skills.has(skill))
        ? 1
        : TEXT_MATCH * shareOfPhrases(entry, phrases);
      if (match === 0) continue;
      relevance += weight * match;
      matched.push(id);
    }
    if (relevance === 0) continue;
    const score = relevance * recency(entry.date, asOf);
    scored.push({ id: entry.id, type: entry.type, score, requirements: matched });
  }
  scored.sort((a, b) => b.score - a.score || compareIds(a.id, b.id));

  const taken = new Map<EntryType, number>();
  return scored.filter(({ type }) => {
    const count = (taken.get(type) ?? 0) + 1;
    taken.set(type, count);
    return count <= limitPerType;
  });
}

/** "Kafka" matches the skill "Apache Kafka", and "Kubernetes operations" the skill "Kubernetes". */
function matchingSkills(entries: Entry[], phrases: string[][]): Set<string> {
  const matches = (name: string[]) =>
    phrases.some((phrase) => containsPhrase(name, phrase) || containsPhrase(phrase, name));
  return new Set(
    entries
      .filter(({ type, names }) => type === "skill" && names.some(matches))
      .map(({ id }) => id),
  );
}

function shareOfPhrases({ texts }: Entry, phrases: string[][]): number {
  if (phrases.length === 0) return 0;
  const found = phrases.filter((phrase) => texts.some((text) => containsPhrase(text, phrase)));
  return found.length / phrases.length;
}

/** Entries without a date, such as skills, are not penalized. */
function recency(date: string | null | undefined, asOf: string): number {
  if (!date) return 1;
  const years = Math.max(0, toYears(asOf) - toYears(date));
  return Math.max(RECENCY_FLOOR, 1 - YEARLY_DECAY * years);
}

function toYears(date: string): number {
  const [year, month] = date.split("-").map(Number);
  return (year ?? 0) + ((month ?? 1) - 1) / 12;
}
