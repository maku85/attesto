import { backs, extractQuantities } from "./quantities.ts";
import {
  KB_FILES,
  LANGS,
  type Issue,
  type KbSection,
  type KnowledgeBase,
  type Lang,
} from "./schema.ts";

/** Rules that span entries. Assumes every file already matches its schema. */
export function crossCheck(kb: KnowledgeBase): Issue[] {
  const issues: Issue[] = [];
  const report = (section: KbSection, path: string, message: string) =>
    issues.push({ file: KB_FILES[section].file, path, message });

  const seen = new Map<string, string>();
  const unique = (section: KbSection, id: string) => {
    const file = KB_FILES[section].file;
    const first = seen.get(id);
    if (first) report(section, id, `duplicate ID, already used in ${first}`);
    else seen.set(id, file);
  };
  const ordered = (
    section: KbSection,
    id: string,
    start: string | undefined,
    end: string | null | undefined,
  ) => {
    if (start && end && isAfter(start, end)) {
      report(section, id, `starts in ${start}, after it ends in ${end}`);
    }
  };

  const skillIds = new Set(kb.skills.map((skill) => skill.id));
  const knownSkills = (section: KbSection, id: string, skills: string[]) => {
    for (const skill of skills) {
      if (!skillIds.has(skill)) report(section, id, `unknown skill ${skill}`);
    }
  };

  unique("person", kb.person.id);
  for (const section of ["experiences", "projects"] as const) {
    for (const owner of kb[section]) {
      unique(section, owner.id);
      for (const achievement of owner.achievements) {
        unique(section, achievement.id);
        knownSkills(section, achievement.id, achievement.skills);
      }
    }
  }
  for (const experience of kb.experiences) {
    ordered("experiences", experience.id, experience.start, experience.end);
  }
  for (const project of kb.projects) knownSkills("projects", project.id, project.tech);
  for (const skill of kb.skills) {
    unique("skills", skill.id);
    ordered("skills", skill.id, skill.since, skill.until);
  }
  for (const education of kb.education) {
    unique("education", education.id);
    ordered("education", education.id, education.start, education.end);
  }
  for (const certification of kb.certifications) {
    unique("certifications", certification.id);
    ordered("certifications", certification.id, certification.date, certification.expires);
  }
  for (const statement of kb.statements) unique("statements", statement.id);

  const { defaultLanguage } = kb.person;
  for (const section of Object.keys(KB_FILES) as KbSection[]) {
    for (const { path, map } of translationMaps(kb[section], "")) {
      const original = map[defaultLanguage];
      if (!original) {
        report(section, path, `missing the default language "${defaultLanguage}"`);
        continue;
      }
      for (const lang of LANGS) {
        const translation = map[lang];
        if (translation && !sameQuantities(original, defaultLanguage, translation, lang)) {
          report(section, path, `"${lang}" and "${defaultLanguage}" do not state the same numbers`);
        }
      }
    }
  }
  return issues;
}

function sameQuantities(a: string, aLang: Lang, b: string, bLang: Lang): boolean {
  const inA = extractQuantities(a, aLang);
  const inB = extractQuantities(b, bLang);
  return (
    inA.every((quantity) => inB.some((other) => backs(other, quantity))) &&
    inB.every((quantity) => inA.some((other) => backs(other, quantity)))
  );
}

/** Compares at the coarser precision: 2021-03 is not after 2021. */
function isAfter(a: string, b: string): boolean {
  const length = Math.min(a.length, b.length);
  return a.slice(0, length) > b.slice(0, length);
}

/** Finds every `{ it, en, de }` map; no other object in the schema has only those keys. */
function* translationMaps(
  value: unknown,
  path: string,
): Generator<{ path: string; map: Partial<Record<Lang, string>> }> {
  if (typeof value !== "object" || value === null) return;
  const entries = Object.entries(value);
  const isMap =
    !Array.isArray(value) &&
    entries.length > 0 &&
    entries.every(([key]) => (LANGS as readonly string[]).includes(key));
  if (isMap) {
    yield { path, map: value };
    return;
  }
  for (const [key, child] of entries) {
    const step = Array.isArray(value) ? `[${key}]` : path ? `.${key}` : key;
    yield* translationMaps(child, path + step);
  }
}
