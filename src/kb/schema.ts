import { z } from "zod";

export const LANGS = ["it", "en", "de"] as const;
export const Lang = z.enum(LANGS);
export type Lang = z.infer<typeof Lang>;

const str = z.string().trim().min(1, "expected a non-empty string");

const TEXT_FORMAT = "expected a non-empty string or a map with the keys it, en, de";
/** A plain string is written in `person.defaultLanguage`; a map holds one text per language. */
export const Text = z.union(
  [
    str,
    z
      .strictObject({ it: str.optional(), en: str.optional(), de: str.optional() })
      .refine((map) => Object.keys(map).length > 0, TEXT_FORMAT),
  ],
  { error: TEXT_FORMAT },
);
export type Text = z.infer<typeof Text>;

const DATE_FORMAT = "expected a date as YYYY or YYYY-MM";
/** YAML reads an unquoted `2021` as a number, so both forms are accepted. */
const PartialDate = z
  .union([z.int(), z.string()], { error: DATE_FORMAT })
  .transform(String)
  .pipe(z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, DATE_FORMAT));

const id = (prefix: string) =>
  z
    .string()
    .regex(
      new RegExp(`^${prefix}-[a-z0-9]+(-[a-z0-9]+)*$`),
      `expected a lowercase ID such as ${prefix}-some-name`,
    );

const Metric = z.strictObject({
  value: z.number(),
  unit: str,
  context: Text,
});

export const Achievement = z.strictObject({
  id: id("ach"),
  statement: Text,
  metrics: z.array(Metric).default([]),
  skills: z.array(id("skl")).default([]),
  date: PartialDate.optional(),
  evidenceUrl: z.url().optional(),
});

export const Experience = z.strictObject({
  id: id("exp"),
  company: str,
  role: Text,
  start: PartialDate,
  /** `null` means current; it must be written out so that a forgotten end date is an error. */
  end: PartialDate.nullable(),
  location: Text,
  description: Text,
  achievements: z.array(Achievement).default([]),
});

export const Project = z.strictObject({
  id: id("prj"),
  name: str,
  url: z.url().optional(),
  description: Text,
  tech: z.array(id("skl")).default([]),
  achievements: z.array(Achievement).default([]),
});

export const Skill = z.strictObject({
  id: id("skl"),
  name: Text,
  /** Other names to find the skill by. They are not facts: a claim cannot use them. */
  aliases: z.array(str).default([]),
  category: Text,
  level: z.enum(["basic", "working", "advanced", "expert"]),
  since: PartialDate.optional(),
  /** `null` means still in use. Years of experience are derived only when this is stated. */
  until: PartialDate.nullable().optional(),
});

export const Education = z.strictObject({
  id: id("edu"),
  institution: str,
  title: Text,
  start: PartialDate.optional(),
  end: PartialDate.nullable(),
  location: Text.optional(),
  description: Text.optional(),
});

export const Certification = z.strictObject({
  id: id("cert"),
  name: str,
  issuer: str,
  date: PartialDate,
  expires: PartialDate.optional(),
  url: z.url().optional(),
});

/** Motivation and availability in the person's own words. Citable in letters only. */
export const Statement = z.strictObject({
  id: id("stm"),
  kind: z.enum(["motivation", "availability"]),
  text: Text,
});

export const Person = z.strictObject({
  id: id("per"),
  name: str,
  defaultLanguage: Lang,
  headline: Text.optional(),
  location: Text,
  contacts: z.strictObject({
    email: z.email(),
    phone: str.optional(),
    links: z.array(z.url()).default([]),
  }),
  nationality: Text.optional(),
  workPermit: Text.optional(),
  birthDate: z.iso.date().optional(),
  languages: z.array(
    z.strictObject({
      language: z.string().regex(/^[a-z]{2}$/, "expected an ISO 639-1 code such as it"),
      level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "native"]),
    }),
  ),
  workCertificatesAvailable: z.boolean().default(false),
});

/** The YAML file each part of the knowledge base lives in, and the schema it must match. */
export const KB_FILES = {
  person: { file: "person.yaml", schema: Person },
  experiences: { file: "experiences.yaml", schema: z.array(Experience) },
  projects: { file: "projects.yaml", schema: z.array(Project) },
  skills: { file: "skills.yaml", schema: z.array(Skill) },
  education: { file: "education.yaml", schema: z.array(Education) },
  certifications: { file: "certifications.yaml", schema: z.array(Certification) },
  statements: { file: "statements.yaml", schema: z.array(Statement) },
} as const;

export type KbSection = keyof typeof KB_FILES;
export type KnowledgeBase = { [K in KbSection]: z.infer<(typeof KB_FILES)[K]["schema"]> };

export type Issue = { file: string; path: string; message: string };
