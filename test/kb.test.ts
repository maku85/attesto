import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadKb, resolveKbDir } from "../src/kb/load.ts";
import type { KnowledgeBase } from "../src/kb/schema.ts";

const EXAMPLE = join(import.meta.dirname, "..", "examples", "kb");
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attesto-kb-"));
  cpSync(EXAMPLE, dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true }));

function write(file: string, content: string) {
  writeFileSync(join(dir, file), content);
}
function replace(file: string, from: string, to: string) {
  const source = readFileSync(join(dir, file), "utf8");
  if (!source.includes(from)) throw new Error(`${file} does not contain ${from}`);
  write(file, source.replace(from, to));
}
function issues(): string[] {
  const result = loadKb(dir);
  return result.ok
    ? []
    : result.issues.map(({ file, path, message }) => `${file} (${path}): ${message}`);
}
function load(): KnowledgeBase {
  const result = loadKb(dir);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.kb;
}

describe("example knowledge base", () => {
  it("is valid and has the promised size", () => {
    const kb = load();
    const achievements = [...kb.experiences, ...kb.projects].flatMap((o) => o.achievements);
    expect(kb.experiences).toHaveLength(4);
    expect(kb.projects).toHaveLength(2);
    expect(achievements).toHaveLength(15);
  });
});

describe("schema", () => {
  it("accepts an unquoted year and normalizes it to a string", () => {
    expect(load().education[0]).toMatchObject({ start: "2011", end: "2014" });
  });

  it.each(["2022-13", "2022-1", "22", "January 2022", "2022.5"])("rejects the date %s", (date) => {
    replace("experiences.yaml", "start: 2022-01", `start: ${date}`);
    expect(issues()).toEqual(["experiences.yaml ([0].start): expected a date as YYYY or YYYY-MM"]);
  });

  it("rejects an ID with the wrong prefix", () => {
    replace("statements.yaml", "id: stm-availability", "id: ach-availability");
    expect(issues()).toEqual([
      "statements.yaml ([1].id): expected a lowercase ID such as stm-some-name",
    ]);
  });

  it("rejects a misspelled field instead of ignoring it", () => {
    replace("skills.yaml", "since: 2018-03", "sinse: 2018-03");
    expect(issues()).toEqual([expect.stringContaining('"sinse"')]);
  });

  it("requires the end of an experience to be written out", () => {
    replace("experiences.yaml", "  end: null\n", "");
    expect(issues()).toEqual([expect.stringContaining("[0].end")]);
  });

  it.each([
    ["{}", "expected a non-empty string or a map"],
    ['""', "expected a non-empty string"],
    ["{ fr: Lugano }", 'Unrecognized key: "fr"'],
    ["[Lugano]", "expected a non-empty string or a map"],
  ])("rejects the text %s", (text, message) => {
    replace("experiences.yaml", "location: Lugano", `location: ${text}`);
    expect(issues()[0]).toContain(`experiences.yaml ([0].location): ${message}`);
  });
});

describe("files", () => {
  it("requires person.yaml only", () => {
    for (const name of ["statements", "certifications", "education"])
      rmSync(join(dir, `${name}.yaml`));
    expect(load().statements).toEqual([]);
    rmSync(join(dir, "person.yaml"));
    expect(issues()).toEqual([expect.stringMatching(/^person\.yaml .*file not found/)]);
  });

  it("treats an empty list file as no entries, but not an empty person.yaml", () => {
    write("statements.yaml", "# nothing yet\n");
    expect(load().statements).toEqual([]);
    write("person.yaml", "");
    expect(issues()).toHaveLength(1);
  });

  it("reports a misnamed file", () => {
    write("skill.yml", "[]");
    expect(issues()).toEqual([expect.stringMatching(/^skill\.yml .*unknown file/)]);
  });

  it("reports a missing directory", () => {
    rmSync(dir, { recursive: true });
    expect(issues()).toEqual([expect.stringContaining("file not found")]);
    cpSync(EXAMPLE, dir, { recursive: true });
  });

  it("gives the line of a YAML error without quoting its content", () => {
    write("person.yaml", "id: per-x\nname: [Secret Name\n");
    expect(issues()).toEqual([expect.stringMatching(/^person\.yaml \(line \d+\)/)]);
    expect(issues().join()).not.toContain("Secret");
  });
});

describe("cross-checks", () => {
  it("rejects a duplicate ID, also across files", () => {
    replace("projects.yaml", "id: ach-quietqueue-release", "id: ach-cantiere-ci");
    expect(issues()).toEqual([
      "projects.yaml (ach-cantiere-ci): duplicate ID, already used in experiences.yaml",
    ]);
  });

  it("rejects an unknown skill in an achievement and in a project", () => {
    replace("experiences.yaml", "skills: [skl-mentoring]", "skills: [skl-ghost]");
    replace("projects.yaml", "tech: [skl-typescript, skl-kubernetes]", "tech: [skl-phantom]");
    expect(issues()).toEqual([
      "experiences.yaml (ach-lagonube-mentoring): unknown skill skl-ghost",
      "projects.yaml (prj-kubeledger): unknown skill skl-phantom",
    ]);
  });

  it("rejects an end before the start", () => {
    replace("experiences.yaml", "end: 2021-12", "end: 2018-12");
    expect(issues()).toEqual([
      "experiences.yaml (exp-pagofacile-2019): starts in 2019-01, after it ends in 2018-12",
    ]);
  });

  it("compares dates of different precision at the coarser one", () => {
    replace("experiences.yaml", "end: 2021-12", "end: 2019");
    expect(issues()).toEqual([]);
  });

  it("requires the default language in every map, however deeply nested", () => {
    replace("person.yaml", "defaultLanguage: en", "defaultLanguage: de");
    replace("experiences.yaml", "context: median deployment time before", "context: { it: prima }");
    expect(issues()).toEqual([
      'experiences.yaml ([0].achievements[0].metrics[0].context): missing the default language "de"',
    ]);
  });
});

describe("resolveKbDir", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers the flag, then the environment, then the home directory", () => {
    vi.stubEnv("ATTESTO_KB", "/from-env");
    expect(resolveKbDir("/from-flag")).toBe("/from-flag");
    expect(resolveKbDir()).toBe("/from-env");
    vi.stubEnv("ATTESTO_KB", "");
    expect(resolveKbDir()).toMatch(/\.attesto\/kb$/);
  });
});
