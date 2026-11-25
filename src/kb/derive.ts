import type { KnowledgeBase } from "./schema.ts";

/** Facts that follow from dates. They are citable, so that "8 years of experience" has a source. */
export type DerivedFact = { id: string; ownerId?: string; months: number; subject: string };

/** Month precision. Where only a year is known, the shortest possible period counts. */
export function deriveFacts(
  kb: KnowledgeBase,
  asOf: string,
  name: (skill: KnowledgeBase["skills"][number]) => string,
): DerivedFact[] {
  const now = toMonth(asOf, 1);
  const facts: DerivedFact[] = [];
  const add = (fact: DerivedFact) => {
    if (fact.months > 0) facts.push(fact);
  };

  const periods = kb.experiences.map(({ id, company, start, end }) => ({
    id,
    company,
    from: toMonth(start, 12),
    // The month in progress does not count; a past end month does.
    to: Math.min(now, end === null ? now : toMonth(end, 1) + 1),
  }));
  for (const { id, company, from, to } of periods) {
    add({
      id: `drv-${id}`,
      ownerId: id,
      months: to - from,
      subject: `Duration of the role at ${company}`,
    });
  }
  add({
    id: "drv-total-experience",
    months: union(periods),
    subject: "Total professional experience, with overlapping roles counted once",
  });
  for (const skill of kb.skills) {
    if (!skill.since) continue;
    add({
      id: `drv-${skill.id}`,
      months: now - toMonth(skill.since, 12),
      subject: `Experience with ${name(skill)}`,
    });
  }
  return facts;
}

/** Months since year 0. `missing` stands in for an unknown month. */
function toMonth(date: string, missing: number): number {
  const [year, month] = date.split("-").map(Number);
  return (year ?? 0) * 12 + (month ?? missing) - 1;
}

function union(periods: { from: number; to: number }[]): number {
  let total = 0;
  let reached = -Infinity;
  for (const { from, to } of [...periods].sort((a, b) => a.from - b.from)) {
    total += Math.max(0, to - Math.max(from, reached));
    reached = Math.max(reached, to);
  }
  return total;
}
