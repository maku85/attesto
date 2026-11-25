import type { KnowledgeBase, Lang, Person, Text } from "./schema.ts";
import { tokenize } from "./tokens.ts";
import type { z } from "zod";

export const ENTRY_TYPES = [
  "person",
  "experience",
  "achievement",
  "project",
  "skill",
  "education",
  "certification",
  "statement",
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** A knowledge-base entry in a uniform shape, for lookup, search and retrieval. */
export type Entry = {
  id: string;
  type: EntryType;
  /** One-line text in the default language. */
  title: string;
  /** The experience or project an achievement belongs to. */
  ownerId?: string;
  skills: string[];
  /** When the fact was last true; `null` means it still is. */
  date?: string | null;
  /** The entry's own texts in every language, tokenized one by one. */
  texts: string[][];
  /** For skills: the name in every language and the aliases, tokenized one by one. */
  names: string[][];
  data: object;
};

export function listEntries(kb: KnowledgeBase): Entry[] {
  const title = (text: Text) =>
    localize(text, kb.person.defaultLanguage, kb.person.defaultLanguage);
  const entries: Entry[] = [];

  const add = (
    entry: Omit<Entry, "texts" | "names">,
    texts: (Text | undefined)[],
    names: Text[] = [],
  ) =>
    entries.push({
      ...entry,
      texts: [...texts, ...names].flatMap(variants).map(tokenize),
      names: names.flatMap(variants).map(tokenize),
    });

  const person = publicPerson(kb.person);
  add({ id: person.id, type: "person", title: person.name, skills: [], data: person }, [
    person.headline,
    person.location,
  ]);

  const owners = [
    ...kb.experiences.map((owner) => ({ section: "experience" as const, owner })),
    ...kb.projects.map((owner) => ({ section: "project" as const, owner })),
  ];
  for (const { section, owner } of owners) {
    const { achievements, ...data } = owner;
    const achievementIds = achievements.map((achievement) => achievement.id);
    if (section === "experience") {
      add(
        {
          id: owner.id,
          type: "experience",
          title: `${title(owner.role)}, ${owner.company}`,
          skills: [],
          date: owner.end,
          data: { ...data, achievements: achievementIds },
        },
        [owner.role, owner.company, owner.location, owner.description],
      );
    } else {
      add(
        {
          id: owner.id,
          type: "project",
          title: owner.name,
          skills: owner.tech,
          data: { ...data, achievements: achievementIds },
        },
        [owner.name, owner.description],
      );
    }
    for (const achievement of achievements) {
      add(
        {
          id: achievement.id,
          type: "achievement",
          title: title(achievement.statement),
          ownerId: owner.id,
          skills: achievement.skills,
          date: achievement.date ?? (section === "experience" ? owner.end : undefined),
          data: achievement,
        },
        [achievement.statement, ...achievement.metrics.map((metric) => metric.context)],
      );
    }
  }

  for (const skill of kb.skills) {
    add(
      {
        id: skill.id,
        type: "skill",
        title: title(skill.name),
        skills: [skill.id],
        data: { ...skill, evidence: evidenceFor(kb, skill.id) },
      },
      [skill.category],
      [skill.name, ...skill.aliases],
    );
  }
  for (const education of kb.education) {
    add(
      {
        id: education.id,
        type: "education",
        title: title(education.title),
        skills: [],
        data: education,
      },
      [education.title, education.institution, education.description],
    );
  }
  for (const certification of kb.certifications) {
    add(
      {
        id: certification.id,
        type: "certification",
        title: certification.name,
        skills: [],
        data: certification,
      },
      [certification.name, certification.issuer],
    );
  }
  for (const statement of kb.statements) {
    add(
      {
        id: statement.id,
        type: "statement",
        title: title(statement.text),
        skills: [],
        data: statement,
      },
      [statement.text],
    );
  }
  return entries;
}

/** Falls back to the default language, which validation guarantees to be present. */
export function localize(text: Text, lang: Lang, defaultLanguage: Lang): string {
  return typeof text === "string" ? text : (text[lang] ?? text[defaultLanguage] ?? "");
}

function variants(text: Text | undefined): string[] {
  if (text === undefined) return [];
  return typeof text === "string" ? [text] : Object.values(text);
}

function evidenceFor(kb: KnowledgeBase, skillId: string): string[] {
  return [
    ...kb.experiences.flatMap((experience) => experience.achievements),
    ...kb.projects.flatMap((project) => project.achievements),
    ...kb.projects.map((project) => ({ id: project.id, skills: project.tech })),
  ]
    .filter(({ skills }) => skills.includes(skillId))
    .map(({ id }) => id);
}

/** An allow-list: contacts, nationality, permit and birth date never reach an LLM. */
function publicPerson(person: z.infer<typeof Person>) {
  const { id, name, headline, location, languages, workCertificatesAvailable } = person;
  return { id, name, headline, location, languages, workCertificatesAvailable };
}
