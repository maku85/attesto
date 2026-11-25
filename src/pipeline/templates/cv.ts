import { localize } from "../../kb/entries.ts";
import type { Lang, Text } from "../../kb/schema.ts";
import { formatDay, formatMonth } from "./dates.ts";
import { fixed, fromKb, type Block, type Line } from "./layout.ts";
import { LABELS } from "./labels.ts";
import { MARKET } from "./markets.ts";
import type { TemplateInput } from "./index.ts";

export function cvTemplate(input: TemplateInput): Block[] {
  const { document, kb, photo } = input;
  const { language: lang, asOf } = document;
  const { person } = kb;
  const label = LABELS[lang];
  const text = (value: Text) => localize(value, lang, person.defaultLanguage);
  const selected = new Set(document.sources.map(({ id }) => id));
  const blocks: Block[] = [];

  const claims = (slot: string): Line[] =>
    document.sections
      .filter((section) => section.slot === slot)
      .flatMap((section) => section.claims)
      .map(({ id, text, sources }) => ({ text, origin: "claim", sources, claimId: id }));
  const section = (heading: string, content: Block[]) => {
    if (content.length > 0) {
      blocks.push({ kind: "heading", line: fixed(heading) }, ...content);
    }
  };
  const bullets = (lines: Line[]): Block[] =>
    lines.length > 0 ? [{ kind: "bullets", lines }] : [];
  const period = (start: string | undefined, end: string | null) => {
    const last = end === null ? label.present : formatMonth(end, lang);
    return start ? `${formatMonth(start, lang)} – ${last}` : `${label.until} ${last}`;
  };

  blocks.push({ kind: "title", line: fromKb(person.name, person.id) });
  blocks.push({
    kind: "subtitle",
    line: person.headline ? fromKb(text(person.headline), person.id) : fixed(label.cv),
  });
  if (photo) blocks.push({ kind: "photo", line: fixed(label.photo) });
  blocks.push({ kind: "details", rows: personalDetails(input) });

  const summary = claims("summary");
  section(label.profile, summary.length > 0 ? [{ kind: "paragraph", lines: summary }] : []);
  section(
    label.experience,
    newestFirst(kb.experiences).flatMap((experience): Block[] => [
      {
        kind: "entry",
        title: fromKb(`${text(experience.role)}, ${experience.company}`, experience.id),
        meta: fromKb(
          `${period(experience.start, experience.end)} · ${text(experience.location)}`,
          experience.id,
        ),
      },
      ...bullets(claims(experience.id)),
    ]),
  );
  section(
    label.projects,
    kb.projects.flatMap((project): Block[] => {
      const lines = claims(project.id);
      if (lines.length === 0) return [];
      const meta = project.url ? { meta: fromKb(project.url, project.id) } : {};
      return [
        { kind: "entry", title: fromKb(project.name, project.id), ...meta },
        ...bullets(lines),
      ];
    }),
  );
  const skills = kb.skills.filter(({ id }) => selected.has(id));
  const categories = [...new Set(skills.map(({ category }) => text(category)))];
  section(
    label.skills,
    bullets(
      categories.map((category) => {
        const members = skills.filter((skill) => text(skill.category) === category);
        // Without the level, basic and expert knowledge would read the same.
        const names = members
          .map(({ name, level }) => `${text(name)} (${label.levels[level]})`)
          .join(", ");
        return fromKb(`${category}: ${names}`, ...members.map(({ id }) => id));
      }),
    ),
  );
  section(
    label.education,
    newestFirst(kb.education).map((education): Block => {
      const place = education.location ? ` · ${text(education.location)}` : "";
      return {
        kind: "entry",
        title: fromKb(`${text(education.title)}, ${education.institution}`, education.id),
        meta: fromKb(`${period(education.start, education.end)}${place}`, education.id),
      };
    }),
  );
  section(
    label.certifications,
    bullets(
      kb.certifications.map(({ id, name, issuer, date, expires }) => {
        const expired = expires !== undefined && expires < asOf.slice(0, expires.length);
        const validity = expires
          ? `, ${expired ? label.expired : label.validUntil} ${formatMonth(expires, lang)}`
          : "";
        return fromKb(`${name}, ${issuer} (${formatMonth(date, lang)}${validity})`, id);
      }),
    ),
  );
  section(
    label.languages,
    bullets(
      person.languages.map(({ language, level }) =>
        fromKb(
          `${languageName(language, lang)}: ${level === "native" ? label.native : level}`,
          person.id,
        ),
      ),
    ),
  );
  if (person.workCertificatesAvailable) {
    section(label.references, [
      { kind: "paragraph", lines: [fromKb(label.certificates, person.id)] },
    ]);
  }
  return blocks;
}

function personalDetails({ document, kb: { person } }: TemplateInput) {
  const { language: lang, market } = document;
  const label = LABELS[lang];
  const text = (value: Text | undefined) =>
    value === undefined ? undefined : localize(value, lang, person.defaultLanguage);
  const optional = {
    birthDate: person.birthDate && formatDay(person.birthDate, lang),
    nationality: text(person.nationality),
    workPermit: text(person.workPermit),
  };
  const rows: [string, string | undefined][] = [
    [label.location, text(person.location)],
    [label.email, person.contacts.email],
    [label.phone, person.contacts.phone],
    ...person.contacts.links.map((link): [string, string] => [label.links, link]),
    ...MARKET[market].personalDetails.map((key): [string, string | undefined] => [
      label[key],
      optional[key],
    ]),
  ];
  return rows.flatMap(([name, value]) =>
    value ? [{ label: name, line: fromKb(value, person.id) }] : [],
  );
}

/** Current entries first, then by end and start. */
function newestFirst<T extends { start?: string; end: string | null }>(entries: T[]): T[] {
  const key = ({ start, end }: T) => `${end ?? "9999"} ${start ?? ""}`;
  return [...entries].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
}

function languageName(code: string, lang: Lang): string {
  const name = new Intl.DisplayNames([lang], { type: "language" }).of(code) ?? code;
  return name.charAt(0).toLocaleUpperCase(lang) + name.slice(1);
}
