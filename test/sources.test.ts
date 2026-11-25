import { expect, it } from "vitest";
import { hashSource, listSources } from "../src/kb/sources.ts";
import { exampleKb } from "./fixtures.ts";

const find = (id: string, asOf = "2026-01-15", lang: "it" | "en" | "de" = "en") => {
  const source = listSources(exampleKb(), asOf, lang).find((candidate) => candidate.id === id);
  if (!source) throw new Error(`no source ${id}`);
  return source;
};

it("states everything an achievement proves, and where it belongs", () => {
  expect(find("ach-lagonube-deploy-time")).toEqual({
    id: "ach-lagonube-deploy-time",
    type: "achievement",
    ownerId: "exp-lagonube-2022",
    facts: [
      "Reduced the median deployment time from 45 to 8 minutes by rewriting the CI/CD pipelines.",
      "median deployment time before: 45 minutes",
      "median deployment time after: 8 minutes",
      "Skills used: CI/CD (GitHub Actions, GitLab CI); Kubernetes (K8s)",
      "Date: 2022-11",
      "Achieved as Senior Platform Engineer at LagoNube SA",
    ],
  });
});

it("uses translations where they exist, and the original elsewhere", () => {
  expect(find("ach-lagonube-deploy-time", "2026-01-15", "it").facts[0]).toContain("Ho ridotto");
  expect(find("ach-lagonube-k8s-migration", "2026-01-15", "it").facts[0]).toContain("Migrated");
});

it.each([
  ["2026-02-28", "Valid until 2026-02"],
  ["2026-03-01", "EXPIRED in 2026-02: no longer valid"],
])("says on %s whether a certification is valid", (asOf, fact) => {
  expect(find("cert-k8s-admin-2023", asOf).facts).toContain(fact);
});

it("rounds a derived duration down to whole years", () => {
  expect(find("drv-exp-pagofacile-2019").facts).toEqual([
    "Duration of the role at PagoFacile AG: 3 years (36 months), as of 2026-01",
  ]);
  expect(find("drv-exp-cantiere-2017").facts[0]).toContain("1 years (23 months)");
});

it("never contains the person or private data", () => {
  const all = JSON.stringify(listSources(exampleKb(), "2026-01-15", "en"));
  expect(all).not.toMatch(/Giulia|example\.com|\+41|1990|C permit|per-/);
});

it("hashes what a source states", () => {
  const source = find("skl-kafka");
  expect(hashSource(source)).toBe(hashSource({ ...source }));
  expect(hashSource({ ...source, facts: [...source.facts, "more"] })).not.toBe(hashSource(source));
});
