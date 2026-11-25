import { describe, expect, it } from "vitest";
import { ENTRY_TYPES, listEntries } from "../src/kb/entries.ts";
import { getEntry, searchKb } from "../src/kb/search.ts";
import { exampleKb } from "./fixtures.ts";

const kb = exampleKb();
const ids = (...args: Parameters<typeof searchKb> extends [unknown, ...infer R] ? R : never) =>
  searchKb(kb, ...args).map(({ id }) => id);

describe("searchKb", () => {
  it("ranks entries that match more words first", () => {
    const hits = searchKb(kb, "payment kafka");
    expect(hits[0]).toMatchObject({ id: "ach-pagofacile-throughput", score: 1 });
    expect(hits.slice(1).every(({ score }) => score === 0.5)).toBe(true);
  });

  it("finds entries through the alias of a linked skill", () => {
    expect(ids("K8s")).toContain("ach-lagonube-cloud-cost");
  });

  it("searches every language and ignores accents and case", () => {
    expect(ids("zurigo")).toEqual(["exp-pagofacile-2019"]);
    expect(ids("ZÜRICH")).toEqual(["exp-pagofacile-2019"]);
  });

  it("filters by type and by skill", () => {
    expect(ids("kubernetes", { types: ["certification"] })).toEqual(["cert-k8s-admin-2023"]);
    expect(ids("", { skill: "skl-terraform", types: ["achievement"] })).toEqual([
      "ach-lagonube-k8s-migration",
      "ach-pagofacile-iac",
    ]);
  });

  it("returns nothing when no word matches", () => {
    expect(ids("cobol")).toEqual([]);
  });
});

describe("getEntry", () => {
  it("returns an achievement with its owner", () => {
    expect(getEntry(kb, "ach-cantiere-ci")).toMatchObject({
      type: "achievement",
      ownerId: "exp-cantiere-2017",
      date: "2017-09",
    });
  });

  it("derives the evidence of a skill from achievements and projects", () => {
    expect(getEntry(kb, "skl-llm")).toMatchObject({
      evidence: ["ach-lagonube-docs-assistant", "ach-kubeledger-mcp"],
    });
    expect(getEntry(kb, "skl-nodejs")).toMatchObject({
      evidence: expect.arrayContaining(["prj-quietqueue"]) as unknown,
    });
  });

  it("covers every entry type and returns undefined for an unknown ID", () => {
    expect(new Set(listEntries(kb).map(({ type }) => type))).toEqual(new Set(ENTRY_TYPES));
    expect(getEntry(kb, "ach-nope")).toBeUndefined();
  });
});

it("never exposes contacts, nationality, permit or birth date", () => {
  const { contacts, nationality, workPermit, birthDate } = kb.person;
  const secrets = [contacts.email, contacts.phone, contacts.links[0], birthDate];
  for (const text of [nationality, workPermit]) {
    secrets.push(...Object.values(text as Record<string, string>));
  }
  const exposed = JSON.stringify(listEntries(kb)) + JSON.stringify(searchKb(kb, ""));
  for (const secret of secrets) {
    expect(secret).toBeTruthy();
    expect(exposed).not.toContain(secret);
  }
  expect(ids("giulia@example.com")).not.toContain(kb.person.id);
});
