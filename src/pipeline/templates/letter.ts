import { localize } from "../../kb/entries.ts";
import { formatDay } from "./dates.ts";
import { fixed, fromKb, type Block, type Line } from "./layout.ts";
import { LABELS } from "./labels.ts";
import type { TemplateInput } from "./index.ts";

const SENTENCES_PER_PARAGRAPH = 3;

export function letterTemplate({ document, kb, analysis }: TemplateInput): Block[] {
  const { language: lang } = document;
  const { person } = kb;
  const label = LABELS[lang];
  const { contacts } = person;
  const sender = [
    person.name,
    localize(person.location, lang, person.defaultLanguage),
    contacts.email,
    contacts.phone,
  ];
  const recipient = [analysis.company, analysis.location].filter((value) => value !== null);
  const body = document.sections
    .flatMap(({ claims }) => claims)
    .map(({ id, text, sources }): Line => ({ text, origin: "claim", sources, claimId: id }));

  const posting = (text: string): Line => ({ text, origin: "posting", sources: [] });
  const paragraph = (...lines: Line[]): Block => ({ kind: "paragraph", lines });
  return [
    {
      kind: "lines",
      lines: sender.flatMap((text) => (text ? [fromKb(text, person.id)] : [])),
    },
    ...(recipient.length > 0 ? [{ kind: "lines" as const, lines: recipient.map(posting) }] : []),
    paragraph(fixed(formatDay(document.asOf, lang))),
    { kind: "heading", line: posting(label.subject(analysis.title)) },
    paragraph(fixed(label.salutation)),
    paragraph(posting(label.opening(analysis.title, analysis.company))),
    ...chunk(body, SENTENCES_PER_PARAGRAPH).map((lines) => paragraph(...lines)),
    ...(person.workCertificatesAvailable ? [paragraph(fromKb(label.certificates, person.id))] : []),
    paragraph(fixed(label.invitation)),
    { kind: "lines", lines: [fixed(label.closing)] },
    { kind: "lines", lines: [fromKb(person.name, person.id)] },
  ];
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
}
