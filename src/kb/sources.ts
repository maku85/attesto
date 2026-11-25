import { createHash } from "node:crypto";
import { deriveFacts } from "./derive.ts";
import { localize, type EntryType } from "./entries.ts";
import type { Achievement, KnowledgeBase, Lang, Text } from "./schema.ts";
import type { z } from "zod";

/**
 * A citable entry as lines of plain text. The drafter, the number check and the judge all work on
 * these lines, so nothing can be accepted on evidence that is not in them.
 */
export type Source = {
  id: string;
  type: EntryType | "derived";
  /** The experience or project this source belongs to. */
  ownerId?: string;
  facts: string[];
};

/**
 * The person is left out: templates render it. Pass the default language to get the originals that
 * claims are checked against, and the target language to draft from existing translations.
 */
export function listSources(kb: KnowledgeBase, asOf: string, lang: Lang): Source[] {
  const text = (value: Text) => localize(value, lang, kb.person.defaultLanguage);
  const month = asOf.slice(0, 7);
  const skillName = new Map(kb.skills.map(({ id, name }) => [id, text(name)]));
  const skillLine = (label: string, ids: string[]) =>
    ids.length > 0 ? [`${label}: ${ids.map((id) => skillName.get(id)).join("; ")}`] : [];
  const period = (start: string | undefined, end: string | null) =>
    `Period: ${start ? `${start} to ` : "until "}${end ?? "present"}`;

  const achievements = (
    owner: { id: string; achievements: z.infer<typeof Achievement>[] },
    context: string,
  ) =>
    owner.achievements.map((achievement): Source => ({
      id: achievement.id,
      type: "achievement",
      ownerId: owner.id,
      facts: [
        text(achievement.statement),
        ...achievement.metrics.map(
          ({ value, unit, context }) => `${text(context)}: ${value} ${unit}`,
        ),
        ...skillLine("Skills used", achievement.skills),
        ...(achievement.date ? [`Date: ${achievement.date}`] : []),
        context,
      ],
    }));

  return [
    ...kb.experiences.flatMap((experience): Source[] => [
      {
        id: experience.id,
        type: "experience",
        ownerId: experience.id,
        facts: [
          `Role: ${text(experience.role)}`,
          `Employer: ${experience.company}`,
          `Location: ${text(experience.location)}`,
          period(experience.start, experience.end),
          text(experience.description),
        ],
      },
      ...achievements(experience, `Achieved as ${text(experience.role)} at ${experience.company}`),
    ]),
    ...kb.projects.flatMap((project): Source[] => [
      {
        id: project.id,
        type: "project",
        ownerId: project.id,
        facts: [
          `Project: ${project.name}`,
          text(project.description),
          ...skillLine("Technologies", project.tech),
        ],
      },
      ...achievements(project, `Achieved in the project ${project.name}`),
    ]),
    ...kb.skills.map((skill): Source => ({
      id: skill.id,
      type: "skill",
      facts: [
        `Skill: ${skillName.get(skill.id)}`,
        `Category: ${text(skill.category)}`,
        `Level: ${skill.level}`,
        ...(skill.since ? [`First used: ${skill.since}`] : []),
        ...(skill.until === null ? ["Still in use"] : []),
        ...(skill.until ? [`Last used: ${skill.until}`] : []),
      ],
    })),
    ...kb.education.map((education): Source => ({
      id: education.id,
      type: "education",
      facts: [
        `Degree: ${text(education.title)}`,
        `Institution: ${education.institution}`,
        period(education.start, education.end),
        ...(education.location ? [`Location: ${text(education.location)}`] : []),
        ...(education.description ? [text(education.description)] : []),
      ],
    })),
    ...kb.certifications.map((certification): Source => ({
      id: certification.id,
      type: "certification",
      facts: [
        `Certification: ${certification.name}`,
        `Issuer: ${certification.issuer}`,
        `Obtained: ${certification.date}`,
        ...(certification.expires
          ? [
              certification.expires < month.slice(0, certification.expires.length)
                ? `EXPIRED in ${certification.expires}: no longer valid`
                : `Valid until ${certification.expires}`,
            ]
          : []),
      ],
    })),
    ...kb.statements.map((statement): Source => ({
      id: statement.id,
      type: "statement",
      facts: [`Own statement of ${statement.kind}: ${text(statement.text)}`],
    })),
    ...deriveFacts(kb, asOf, ({ id }) => skillName.get(id) ?? id).map(
      ({ id, ownerId, months, subject }): Source => ({
        id,
        type: "derived",
        ownerId,
        facts: [`${subject}: ${inWords(months)}, as of ${month}`],
      }),
    ),
  ];
}

export function hashSource({ facts }: Source): string {
  return createHash("sha256").update(facts.join("\n")).digest("hex");
}

/** Whole years only, so that a duration is never rounded up. */
function inWords(months: number): string {
  const years = Math.floor(months / 12);
  return years > 0 ? `${years} years (${months} months)` : `${months} months`;
}
