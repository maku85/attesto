import { describe, expect, it } from "vitest";
import { deriveFacts } from "../src/kb/derive.ts";
import { exampleKb } from "./fixtures.ts";

const months = (kb = exampleKb(), asOf = "2026-01-15") =>
  Object.fromEntries(deriveFacts(kb, asOf, ({ id }) => id).map((fact) => [fact.id, fact.months]));

function withPeriods(...periods: [start: string, end: string | null][]) {
  const kb = exampleKb();
  kb.experiences = periods.map(([start, end], i) => ({
    ...kb.experiences[0]!,
    id: `exp-${i}`,
    start,
    end,
  }));
  return months(kb);
}

describe("roles", () => {
  it("counts whole months, including the last one of a past role", () => {
    expect(months()).toMatchObject({
      "drv-exp-pagofacile-2019": 36,
      "drv-exp-cantiere-2017": 23,
      "drv-exp-tecnobanca-2014": 29,
    });
  });

  it("does not count the month in progress of a current role", () => {
    expect(months()["drv-exp-lagonube-2022"]).toBe(48);
    expect(months(exampleKb(), "2026-02-28")["drv-exp-lagonube-2022"]).toBe(49);
  });

  it("never overstates a role known by year only", () => {
    expect(withPeriods(["2019", "2021"])["drv-exp-0"]).toBe(14);
    expect(withPeriods(["2021", "2021"])["drv-exp-0"]).toBeUndefined();
  });

  it("leaves out a role that has not started, and caps one that ends later", () => {
    expect(withPeriods(["2027-01", null])["drv-exp-0"]).toBeUndefined();
    expect(withPeriods(["2025-01", "2030-12"])["drv-exp-0"]).toBe(12);
  });
});

describe("total experience", () => {
  it("adds up roles", () => {
    expect(months()["drv-total-experience"]).toBe(48 + 36 + 23 + 29);
  });

  it.each<[string, [string, string | null][], number]>([
    [
      "overlapping",
      [
        ["2020-01", "2021-12"],
        ["2021-01", "2022-12"],
      ],
      36,
    ],
    [
      "nested",
      [
        ["2020-01", "2022-12"],
        ["2021-01", "2021-06"],
      ],
      36,
    ],
    [
      "separate, out of order",
      [
        ["2022-01", "2022-12"],
        ["2020-01", "2020-12"],
      ],
      24,
    ],
  ])("counts %s roles once", (_, periods, expected) => {
    expect(withPeriods(...periods)["drv-total-experience"]).toBe(expected);
  });
});

it("derives experience with a skill from its start", () => {
  expect(months()["drv-skl-terraform"]).toBe(58);
  const kb = exampleKb();
  delete kb.skills[0]?.since;
  expect(months(kb)["drv-skl-typescript"]).toBeUndefined();
});
