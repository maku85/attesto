import { listEntries, type Entry, type EntryType } from "./entries.ts";
import type { KnowledgeBase } from "./schema.ts";
import { tokenize } from "./tokens.ts";

export type SearchFilters = { types?: EntryType[]; skill?: string };
export type SearchHit = Pick<Entry, "id" | "type" | "title" | "ownerId"> & { score: number };

/** Ranks entries by the share of query words found in them or in the names of their skills. */
export function searchKb(kb: KnowledgeBase, query: string, filters: SearchFilters = {}) {
  const words = [...new Set(tokenize(query))];
  const entries = listEntries(kb);
  const skillTexts = new Map(
    entries.filter(({ type }) => type === "skill").map(({ id, texts }) => [id, texts]),
  );

  const hits: SearchHit[] = [];
  for (const { id, type, title, ownerId, skills, texts } of entries) {
    if (filters.types && !filters.types.includes(type)) continue;
    if (filters.skill && !skills.includes(filters.skill)) continue;
    const vocabulary = new Set(
      [...texts, ...skills.flatMap((s) => skillTexts.get(s) ?? [])].flat(),
    );
    const found = words.filter((word) => vocabulary.has(word)).length;
    // An empty query lists everything the filters allow.
    const score = words.length === 0 ? 1 : found / words.length;
    if (score > 0) hits.push({ id, type, title, ownerId, score });
  }
  return hits.sort((a, b) => b.score - a.score || compareIds(a.id, b.id));
}

export function getEntry(kb: KnowledgeBase, id: string) {
  const entry = listEntries(kb).find((candidate) => candidate.id === id);
  return entry && { type: entry.type, ownerId: entry.ownerId, ...entry.data };
}

/** Locale-independent, so that rankings do not depend on the machine. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
