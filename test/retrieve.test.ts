import { describe, expect, it } from "vitest";
import { currentAchievements, retrieve } from "../src/pipeline/retrieve.ts";
import { analysis, exampleKb, requirement } from "./fixtures.ts";

const asOf = "2026-01-15";
const run = (...requirements: ReturnType<typeof requirement>[]) =>
  retrieve(exampleKb(), analysis(...requirements), { asOf });
const score = (entries: ReturnType<typeof run>, id: string) =>
  entries.find((entry) => entry.id === id)?.score;

describe("matching", () => {
  it.each(["K8s", "kubernetes", "Kubernetes operations"])("finds the skill for %j", (keyword) => {
    const ids = run(requirement("req-1", "must", keyword)).map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining(["skl-kubernetes", "ach-lagonube-k8s-migration"]));
  });

  it("matches part of a skill name, but not part of a word", () => {
    expect(score(run(requirement("req-1", "must", "Script")), "skl-typescript")).toBeUndefined();
    expect(score(run(requirement("req-1", "must", "Kafka")), "skl-kafka")).toBeGreaterThan(1);
    expect(run(requirement("req-1", "must", "JavaScript"))).toEqual([]);
  });

  it("does not treat a category as a skill name", () => {
    const ids = run(requirement("req-1", "must", "Databases")).map(({ id }) => id);
    expect(ids).toEqual(["skl-postgresql"]);
  });

  it("falls back to the text of the entry, at half the weight", () => {
    const [hit] = run(requirement("req-1", "must", "reconciliation"));
    expect(hit?.id).toBe("ach-pagofacile-reconciliation");
    expect(hit?.score).toBeLessThanOrEqual(1);
  });

  it("matches texts in any language", () => {
    const ids = run(requirement("req-1", "must", "Zahlungsdienste")).map(({ id }) => id);
    expect(ids).toEqual(["exp-pagofacile-2019"]);
  });

  it("sends nothing that is unrelated to the posting", () => {
    expect(run(requirement("req-1", "must", "COBOL"))).toEqual([]);
    expect(run(requirement("req-1", "must", "..."))).toEqual([]);
  });

  it("never selects the person or a statement", () => {
    const types = run(requirement("req-1", "must", "platform", "Lugano", "teams", "backend")).map(
      ({ type }) => type,
    );
    expect(types).not.toContain("person");
    expect(types).not.toContain("statement");
  });
});

describe("scoring", () => {
  it("weighs a must-have twice as much as a nice-to-have", () => {
    const must = score(run(requirement("req-1", "must", "Docker")), "skl-docker");
    const nice = score(run(requirement("req-1", "nice", "Docker")), "skl-docker");
    expect(must).toBe(2 * (nice ?? NaN));
  });

  it("adds up the requirements an entry speaks to", () => {
    const hits = run(
      requirement("req-1", "must", "Kubernetes"),
      requirement("req-2", "must", "CI/CD"),
    );
    expect(hits[0]).toMatchObject({
      id: "ach-lagonube-deploy-time",
      requirements: ["req-1", "req-2"],
    });
  });

  it("prefers recent facts, with a floor for old ones", () => {
    const hits = run(requirement("req-1", "must", "PostgreSQL"));
    expect(score(hits, "ach-pagofacile-query-latency")).toBeGreaterThan(
      score(hits, "ach-tecnobanca-batch") ?? NaN,
    );
    const old = retrieve(exampleKb(), analysis(requirement("req-1", "must", "Java")), {
      asOf: "2060-01-01",
    });
    expect(score(old, "ach-tecnobanca-batch")).toBe(1);
  });

  it("ranks a skill no longer in use below one in use", () => {
    const hits = run(requirement("req-1", "must", "Kafka"), requirement("req-2", "must", "Docker"));
    expect(score(hits, "skl-kafka")).toBeLessThan(score(hits, "skl-docker") ?? NaN);
  });

  it("treats an undated achievement of the current job as current", () => {
    expect(score(run(requirement("req-1", "must", "Mentoring")), "ach-lagonube-mentoring")).toBe(2);
  });

  it("limits each type on its own", () => {
    const hits = retrieve(
      exampleKb(),
      analysis(requirement("req-1", "must", "TypeScript", "Kubernetes", "PostgreSQL")),
      { asOf, limitPerType: 2 },
    );
    const count = (type: string) => hits.filter((hit) => hit.type === type).length;
    expect([count("achievement"), count("skill"), count("project")]).toEqual([2, 2, 2]);
  });

  it("does not depend on the order of the files", () => {
    const requirements = [
      requirement("req-1", "must", "Kubernetes", "Terraform"),
      requirement("req-2", "nice", "Kafka"),
    ];
    const reversed = exampleKb();
    for (const list of [reversed.experiences, reversed.projects, reversed.skills]) list.reverse();
    for (const owner of reversed.experiences) owner.achievements.reverse();
    expect(retrieve(reversed, analysis(...requirements), { asOf })).toEqual(run(...requirements));
  });
});

describe("currentAchievements", () => {
  const current = exampleKb().experiences[0]!.achievements.map(({ id }) => id);

  it("adds what the current role is missing, newest first", () => {
    const added = currentAchievements(exampleKb(), new Set(["ach-lagonube-deploy-time"]));
    expect(added).toHaveLength(current.length - 1);
    // Undated achievements of a current role count as current.
    expect(added.slice(0, 2)).toEqual(["ach-lagonube-mentoring", "ach-lagonube-docs-assistant"]);
    expect(added.every((id) => current.includes(id))).toBe(true);
  });

  it("counts the matched ones towards the limit", () => {
    const matched = new Set(current.slice(0, 3));
    expect(currentAchievements(exampleKb(), matched, 4)).toHaveLength(1);
    expect(currentAchievements(exampleKb(), matched, 2)).toEqual([]);
  });

  it("uses the latest role when none is current, and all current ones", () => {
    const past = exampleKb();
    past.experiences[0]!.end = "2020-01";
    expect(currentAchievements(past, new Set())).toContain("ach-pagofacile-iac");
    expect(currentAchievements(past, new Set())).not.toContain("ach-lagonube-mentoring");
    const two = exampleKb();
    two.experiences[1]!.end = null;
    expect(currentAchievements(two, new Set())).toEqual(
      expect.arrayContaining(["ach-pagofacile-iac", "ach-lagonube-mentoring"]),
    );
  });

  it("works without experiences", () => {
    expect(currentAchievements({ ...exampleKb(), experiences: [] }, new Set())).toEqual([]);
  });
});
