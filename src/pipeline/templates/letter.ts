import { localize } from "../../kb/entries.ts";
import { formatDay } from "./dates.ts";
import { fixed, fromKb, type Block, type Line } from "./layout.ts";
import { LABELS } from "./labels.ts";
import type { Claim } from "../document.ts";
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
  // A place alone is not a recipient.
  const recipient = analysis.company
    ? [analysis.company, analysis.location].filter((value) => value !== null)
    : [];
  const claims = document.sections.flatMap((section) => section.claims);
  const toLine = ({ id, text, sources }: Claim): Line => ({
    text,
    origin: "claim",
    sources,
    claimId: id,
  });

  // Why the person writes comes first, as a paragraph of its own.
  const motivations = new Set(
    kb.statements.filter(({ kind }) => kind === "motivation").map(({ id }) => id),
  );
  const isMotivation = ({ sources }: Claim) =>
    sources.length > 0 && sources.every((id) => motivations.has(id));
  const opening = claims.filter(isMotivation).map(toLine);
  const rest = claims.filter((claim) => !isMotivation(claim));
  // The drafter marks where a theme starts; without marks, a paragraph has three sentences.
  const paragraphs = rest.some(({ newParagraph }) => newParagraph)
    ? rest.reduce<Claim[][]>((groups, claim) => {
        const last = groups.at(-1);
        if (!last || claim.newParagraph) groups.push([claim]);
        else last.push(claim);
        return groups;
      }, [])
    : chunk(rest, SENTENCES_PER_PARAGRAPH);

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
    ...(opening.length > 0 ? [paragraph(...opening)] : []),
    ...paragraphs.map((group) => paragraph(...group.map(toLine))),
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
