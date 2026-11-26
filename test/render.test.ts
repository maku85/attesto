import { describe, expect, it } from "vitest";
import type { Lang } from "../src/kb/schema.ts";
import type { Document, Verification } from "../src/pipeline/document.ts";
import { buildReport, reportToMarkdown } from "../src/pipeline/provenance.ts";
import { escapeMarkdown, toHtml, toMarkdown } from "../src/pipeline/render.ts";
import { layOut, type TemplateInput } from "../src/pipeline/templates/index.ts";
import { linesOf } from "../src/pipeline/templates/layout.ts";
import { analysis, exampleKb } from "./fixtures.ts";

const LANGS: Lang[] = ["it", "en", "de"];
const MARKETS: Document["market"][] = ["ch-it", "ch-en", "ch-de"];

function input(
  overrides: Partial<Document> = {},
  rest: Partial<TemplateInput> = {},
): TemplateInput {
  const claim = (id: string, text: string, ...sources: string[]) => ({
    id,
    text,
    sources,
    addresses: [],
  });
  const sections =
    overrides.type === "letter"
      ? [
          {
            slot: "letter-body",
            claims: ["One.", "Two.", "Three.", "Four."].map((text, i) =>
              claim(`c-${i}`, text, "skl-kubernetes"),
            ),
          },
        ]
      : [
          { slot: "summary", claims: [claim("c-1", "Works on Kubernetes.", "skl-kubernetes")] },
          {
            slot: "exp-lagonube-2022",
            claims: [claim("c-2", "Cut it to 8 minutes.", "ach-lagonube-deploy-time")],
          },
          {
            slot: "prj-kubeledger",
            claims: [claim("c-3", "Added an MCP server.", "ach-kubeledger-mcp")],
          },
        ];
  return {
    document: {
      schemaVersion: 1,
      runId: "run-1",
      type: "cv",
      language: "en",
      market: "ch-en",
      asOf: "2026-06-15",
      sources: ["skl-kubernetes", "skl-terraform", "skl-llm"].map((id) => ({ id, sha256: "x" })),
      sections,
      ...overrides,
    },
    kb: exampleKb(),
    analysis: analysis(),
    photo: false,
    ...rest,
  };
}
const markdown = (...args: Parameters<typeof input>) => toMarkdown(layOut(input(...args)));
const html = (...args: Parameters<typeof input>) => {
  const given = input(...args);
  return toHtml(layOut(given), {
    lang: given.document.language,
    type: given.document.type,
  });
};

describe("every language, market and type", () => {
  const cases = LANGS.flatMap((language) =>
    MARKETS.flatMap((market) =>
      (["cv", "letter"] as const).map((type) => ({ language, market, type })),
    ),
  );
  it.each(cases)("$type $language $market shows each claim once", (document) => {
    const given = input(document);
    const claims = given.document.sections.flatMap((section) => section.claims);
    for (const output of [markdown(document), html(document)]) {
      for (const { text } of claims) expect(output.split(text)).toHaveLength(2);
      expect(output).not.toMatch(/undefined|null|NaN|\[object|ß/);
    }
  });

  it.each(cases)("$type $language $market mentions the work certificates", (document) => {
    expect(markdown(document)).toMatch(/certificati di lavoro|Work certificates|Arbeitszeugnisse/);
    const kb = exampleKb();
    kb.person.workCertificatesAvailable = false;
    expect(markdown(document, { kb })).not.toMatch(
      /certificati di lavoro|Work certificates|Arbeitszeugnisse/i,
    );
  });
});

describe("CV", () => {
  it.each<[Document["market"], boolean]>([
    ["ch-it", true],
    ["ch-de", true],
    ["ch-en", false],
  ])("shows the customary personal details for %s", (market, birthDate) => {
    const output = markdown({ market });
    expect(output.includes("12 April 1990")).toBe(birthDate);
    expect(output).toContain("**Nationality:** Italian");
    expect(output).toContain("**Work permit:** Swiss C permit");
  });

  it("leaves out details that are not in the knowledge base", () => {
    const kb = exampleKb();
    delete kb.person.birthDate;
    delete kb.person.workPermit;
    delete kb.person.contacts.phone;
    expect(markdown({ market: "ch-de" }, { kb })).not.toMatch(/birth|permit|Phone/);
  });

  it("lists every job, newest first, and only projects with a claim", () => {
    const output = markdown();
    const order = ["LagoNube SA", "PagoFacile AG", "Cantiere Digitale Sagl", "TecnoBanca SpA"];
    const positions = order.map((name) => output.indexOf(`${name}\n`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions).not.toContain(-1);
    expect(output).toContain("kubeledger");
    expect(output).not.toContain("quietqueue");
  });

  it("puts claims under the employer they belong to", () => {
    const output = markdown();
    expect(output.indexOf("Cut it to 8 minutes.")).toBeLessThan(output.indexOf("PagoFacile AG"));
    expect(output.indexOf("Cut it to 8 minutes.")).toBeGreaterThan(output.indexOf("LagoNube SA"));
  });

  it("lists selected skills, and the advanced ones still in use", () => {
    const skills = /## Skills\n\n([^#]*)/.exec(markdown())?.[1] ?? "";
    // Selected, and below advanced.
    expect(skills).toContain("LLM integration (working knowledge)");
    // Not selected, but advanced or expert.
    expect(skills).toContain("TypeScript (expert)");
    expect(skills).toContain("Docker (advanced)");
    // Neither, or no longer in use.
    expect(skills).not.toMatch(/Kafka|Python|Grafana|Java \(/);
  });

  it("lists a selected skill no longer in use", () => {
    expect(markdown({ sources: [{ id: "skl-java", sha256: "x" }] })).toContain("Java (advanced)");
  });

  it.each([
    ["2026-02-28", "valid until February 2026"],
    ["2026-03-01", "expired February 2026"],
  ])("on %s says that the certification is %s", (asOf, text) => {
    expect(markdown({ asOf })).toContain(text);
  });

  it.each<[Lang, string[]]>([
    [
      "it",
      [
        "gennaio 2022 – oggi",
        "Kubernetes (avanzato)",
        "(operativo)",
        "Italiano: madrelingua",
        "Inglese: C1",
        "Zurigo",
        "2011 – 2014",
      ],
    ],
    ["en", ["January 2022 – present", "Italian: native", "English: C1", "Zurich"]],
    [
      "de",
      [
        "Januar 2022 – heute",
        "Kubernetes (fortgeschritten)",
        "(praktische Kenntnisse)",
        "Italienisch: Muttersprache",
        "Englisch: C1",
        "Zürich",
      ],
    ],
  ])("is localized in %s", (language, texts) => {
    for (const text of texts) expect(markdown({ language })).toContain(text);
  });

  it("leaves room for a photo only when asked", () => {
    expect(html()).not.toContain('class="photo"');
    expect(html({}, { photo: true })).toContain('<div class="photo">Photo</div>');
  });

  it("leaves out empty sections", () => {
    const kb = exampleKb();
    for (const skill of kb.skills) skill.level = "basic";
    const output = markdown({ sections: [], sources: [] }, { kb });
    expect(output).not.toMatch(/## (Profile|Projects|Skills)/);
    expect(output).toContain("## Professional experience");
  });
});

describe("letter", () => {
  it("names the company and position, and groups the sentences", () => {
    const output = markdown({ type: "letter" });
    expect(output).toContain("“Platform Engineer” at Esempio SA.");
    expect(output).toContain("One. Two. Three.\n\nFour.");
    expect(output).toContain("15 June 2026");
  });

  it("keeps addresses on separate lines", () => {
    expect(markdown({ type: "letter" })).toContain("Giulia Esempio\\\nLugano, Switzerland\\\n");
    expect(html({ type: "letter" })).toContain("Giulia Esempio<br>Lugano, Switzerland<br>");
  });

  it.each<[Lang, string, string]>([
    ["it", "## Candidatura\n", "mi candido per la posizione pubblicata presso Esempio SA."],
    ["en", "## Application\n", "I am applying for the advertised position at Esempio SA."],
    ["de", "## Bewerbung\n", "Ich bewerbe mich um die ausgeschriebene Stelle bei Esempio SA."],
  ])("does without a title in %s", (language, subject, opening) => {
    const output = markdown(
      { type: "letter", language },
      { analysis: { ...analysis(), title: null } },
    );
    expect(output).toContain(subject);
    expect(output).toContain(opening);
    expect(output).not.toContain("null");
  });

  it("shows no recipient without a company, even if the place is known", () => {
    const place = { ...analysis(), location: "Bern or Basel" };
    expect(markdown({ type: "letter" }, { analysis: place })).toContain(
      "Esempio SA\\\nBern or Basel",
    );
    expect(markdown({ type: "letter" }, { analysis: { ...place, company: null } })).not.toContain(
      "Bern",
    );
  });

  it("starts paragraphs where the drafter marked them, also after a short one", () => {
    const claim = (id: string, text: string, newParagraph: boolean) => ({
      id,
      text,
      sources: ["ach-cantiere-ci"],
      addresses: [],
      newParagraph,
    });
    const output = markdown({
      type: "letter",
      sections: [
        {
          slot: "letter-body",
          claims: [
            claim("c-1", "First.", true),
            claim("c-2", "Second.", false),
            claim("c-3", "Third.", false),
            claim("c-4", "Fourth.", false),
            claim("c-5", "Fifth.", true),
          ],
        },
      ],
    });
    expect(output).toContain("First. Second. Third. Fourth.\n\nFifth.");
  });

  it("opens with what rests on a motivation alone", () => {
    const claim = (id: string, text: string, ...sources: string[]) => ({
      id,
      text,
      sources,
      addresses: [],
    });
    const output = markdown({
      type: "letter",
      sections: [
        {
          slot: "letter-body",
          claims: [
            claim("c-1", "Worked.", "ach-cantiere-ci"),
            claim("c-2", "Available.", "stm-availability"),
            claim("c-3", "Mixed.", "stm-platform-motivation", "ach-cantiere-ci"),
            claim("c-4", "Motivated.", "stm-platform-motivation"),
          ],
        },
      ],
    });
    expect(output).toContain("Motivated.\n\nWorked. Available. Mixed.");
  });

  it("does without a company", () => {
    const output = markdown({ type: "letter" }, { analysis: { ...analysis(), company: null } });
    expect(output).toContain("“Platform Engineer”.");
  });

  it("follows Swiss German custom: no comma after salutation and closing", () => {
    const output = markdown({ type: "letter", language: "de", market: "ch-de" });
    expect(output).toContain("Sehr geehrte Damen und Herren\n");
    expect(output).toContain("Freundliche Grüsse\n");
  });
});

describe("HTML structure", () => {
  it("is the same in every template, and has a policy that blocks requests", () => {
    const given = input();
    const body = (template: "classic" | "modern") =>
      toHtml(layOut(given), { lang: "en", type: "cv", template }).split("</style>")[1];
    expect(body("modern")).toBe(body("classic"));
    expect(html()).toContain("default-src 'none'");
    expect(html()).not.toMatch(/<script|<img|@import|url\(/);
  });

  it("groups headings into sections and bullets with their entry", () => {
    expect(html()).toMatch(
      /<section>\s*<h2>Professional experience<\/h2>\s*<div>\s*<div class="entry"><h3>[^<]*LagoNube SA<\/h3>.*?<ul>/s,
    );
    const output = html();
    expect(output.match(/<section>/g)?.length).toBe(output.match(/<\/section>/g)?.length);
    expect(output.match(/<h2>/g)?.length).toBe(output.match(/<section>/g)?.length);
  });

  it("marks a letter, whose sender comes before the subject", () => {
    const output = html({ type: "letter" });
    expect(output).toContain('<body class="letter">');
    expect(output.indexOf("giulia@example.com")).toBeLessThan(output.indexOf("<h2>"));
  });
});

describe("escaping", () => {
  const hostile = '<img src=x onerror=alert(1)> [x](javascript:alert(1)) **b** & "q"';
  const given = { analysis: { ...analysis(), title: hostile, company: "# H\n# I" } };

  it("keeps a posting from adding markup to HTML", () => {
    const output = html({ type: "letter" }, given);
    expect(output).not.toContain("<img");
    expect(output).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(output).not.toMatch(/<a /);
  });

  it("keeps a posting from adding markup to Markdown", () => {
    const output = markdown({ type: "letter" }, given);
    expect(output).toContain("\\<img");
    expect(output).toContain("\\[x\\](javascript");
    expect(output).not.toMatch(/^# /m);
  });

  it.each([
    ["- item", "\\- item"],
    ["1. item", "1\\. item"],
    ["a_b*c`d", "a\\_b\\*c\\`d"],
    ["one\n\n# two", "one \\# two"],
    ["Node.js, CI/CD and C++", "Node.js, CI/CD and C++"],
    ["-27% by 2021.", "-27% by 2021."],
  ])("turns %j into %j", (text, expected) => {
    expect(escapeMarkdown(text)).toBe(expected);
  });

  it("links web addresses only", () => {
    expect(html()).toContain('<a href="https://example.com/giulia">');
    const kb = exampleKb();
    kb.person.contacts.links = ["javascript://%0aalert(1)"];
    expect(html({}, { kb })).not.toContain('href="javascript');
  });
});

describe("provenance report", () => {
  const given = input();
  const blocks = layOut(given);
  const verifications = given.document.sections
    .flatMap((section) => section.claims)
    .map(({ id, text, sources }): Verification => ({
      claimId: id,
      attempt: 1,
      text,
      sources,
      structural: [],
      numeric: [],
      entailment: { verdict: "supported", reason: "states | it", model: "judge" },
      decision: "accepted",
    }));
  const rejected: Verification = {
    claimId: "c-9",
    attempt: 1,
    text: "Cut costs by 90%.",
    sources: ["ach-ghost"],
    structural: ["unknown-source"],
    numeric: ["90"],
    entailment: null,
    decision: "dropped",
  };
  const report = buildReport(given.document, blocks, [...verifications, rejected], given.kb);

  it("covers every visible line, and every claim has a verification", () => {
    expect(report.lines).toHaveLength(linesOf(blocks).length);
    const output = toMarkdown(blocks);
    for (const { text } of report.lines) expect(output).toContain(escapeMarkdown(text));
    const claims = report.lines.filter(({ origin }) => origin === "claim");
    expect(claims.map(({ verification }) => verification?.decision)).toEqual(
      Array(3).fill("accepted"),
    );
  });

  it("gives every line copied from the knowledge base a source that exists", () => {
    const ids = new Set(
      JSON.stringify(given.kb).match(/"(?:per|exp|ach|prj|skl|edu|cert)-[a-z0-9-]+"/g),
    );
    const copied = report.lines.filter(({ origin }) => origin === "kb");
    expect(copied.length).toBeGreaterThan(10);
    for (const { sources } of copied) {
      expect(sources.length).toBeGreaterThan(0);
      for (const id of sources) expect(ids).toContain(`"${id}"`);
    }
  });

  it("shows what the cited entries state, and what was rejected", () => {
    const text = reportToMarkdown(report);
    expect(text).toContain("### `ach-lagonube-deploy-time`");
    expect(text).toContain("median deployment time before: 45 minutes");
    expect(text).toContain("unknown-source; no cited source states 90");
    expect(text).toContain("states \\| it");
    for (const row of text.split("\n").filter((line) => line.startsWith("| c-9"))) {
      expect(row.split(/(?<!\\)\|/)).toHaveLength(7);
    }
  });

  it.each<[string, Verification[]]>([
    ["was never verified", verifications.slice(1)],
    ["was changed afterwards", verifications.map((v) => ({ ...v, text: `${v.text}!` }))],
    ["was dropped", verifications.map((v) => ({ ...v, decision: "dropped" as const }))],
  ])("refuses a document with a claim that %s", (_, checks) => {
    expect(() => buildReport(given.document, blocks, checks, given.kb)).toThrow("no accepted");
  });
});
