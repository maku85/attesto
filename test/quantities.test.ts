import { describe, expect, it } from "vitest";
import { backs, extractQuantities } from "../src/kb/quantities.ts";
import type { Lang } from "../src/kb/schema.ts";

/** Compact form: "percent:27", with alternatives joined by "|". */
const read = (text: string, lang: Lang = "en") =>
  extractQuantities(text, lang).map(({ kind, values }) => `${kind}:${values.join("|")}`);
const backed = (claim: string, source: string, lang: Lang = "en") =>
  extractQuantities(claim, lang).every((quantity) =>
    extractQuantities(source, "en").some((other) => backs(other, quantity)),
  );

describe("notation", () => {
  it.each([
    ["1'500 users", "count:1500"],
    ["1’500 users", "count:1500"],
    ["1\u00a0500 users", "count:1500"],
    ["1\u202f500\u202f000 users", "count:1500000"],
    ["1.500,5 users", "count:1500.5"],
    ["1,500.5 users", "count:1500.5"],
    ["1.500.000 users", "count:1500000"],
    ["1.500 users", "count:1500|1.5"],
    ["1,500 users", "count:1500|1.5"],
    ["0.250 users", "count:0.25"],
    ["2.5 users", "count:2.5"],
    ["2,5 users", "count:2.5"],
    ["version 1.2.3", "count:1.2.3"],
    ["version 22.18.0.", "count:22.18.0"],
    ["10k users", "count:10000"],
    ["2.5M users", "count:2500000"],
    ["3 million users", "count:3000000"],
    ["two hundred users", "count:200"],
    ["the 95th percentile", "count:95"],
    ["grew by +35%", "percent:35"],
    ["４０ users", "count:40"],
    ["4\u200b0 users", "count:40"],
  ])("reads %j", (text, expected) => {
    expect(read(text)).toEqual([expected]);
  });

  it("keeps digits of other scripts, which no source can back", () => {
    expect(read("٤٠ users")).toEqual(["count:٤٠"]);
    expect(backed("٤٠ users", "40 users")).toBe(false);
  });

  it("finds nothing in plain text", () => {
    expect(read("Reduced the deployment time, once and for all.")).toEqual([]);
  });
});

describe("units", () => {
  it.each<[string, Lang, string]>([
    ["27%", "en", "percent:27"],
    ["27 per cent", "en", "percent:27"],
    ["27 per cento", "it", "percent:27"],
    ["27 Prozent", "de", "percent:27"],
    ["eine 27-prozentige Senkung", "de", "percent:27"],
    ["CHF 500", "de", "money:CHF 500"],
    ["CHF500", "de", "money:CHF 500"],
    ["500 Franken", "de", "money:CHF 500"],
    ["2 milioni di euro", "it", "money:EUR 2000000"],
    ["€ 1.2M", "en", "money:EUR 1200000"],
    ["8 minutes", "en", "duration:480 s"],
    ["8-minute", "en", "duration:480 s"],
    ["8 minuti", "it", "duration:480 s"],
    ["8-Minuten-Deployment", "de", "duration:480 s"],
    ["1.5 hours", "en", "duration:5400 s"],
    ["250 ms", "en", "duration:0.25 s"],
    ["3 years", "en", "duration:36 mo"],
    ["3+ years", "en", "duration:36 mo"],
    ["36 Monate", "de", "duration:36 mo"],
    ["dreijährige Erfahrung", "de", "duration:36 mo"],
    ["three-year", "en", "duration:36 mo"],
    ["tre anni", "it", "duration:36 mo"],
    ["3x faster", "en", "factor:3"],
    ["dreifach", "de", "factor:3"],
    ["35 alerts per month", "en", "count:35"],
  ])("reads %j", (text, lang, expected) => {
    expect(read(text, lang)).toEqual([expected]);
  });

  it.each<[string, Lang]>([
    ["from 45 to 8 minutes", "en"],
    ["da 45 a 8 minuti", "it"],
    ["von 45 auf 8 Minuten", "de"],
    ["45 → 8 min", "en"],
  ])("shares the unit in %j", (text, lang) => {
    expect(read(text, lang)).toEqual(["duration:2700 s", "duration:480 s"]);
  });

  it("does not share a unit across other words", () => {
    expect(read("3 services in 8 minutes")).toEqual(["count:3", "duration:480 s"]);
  });
});

describe("number words", () => {
  it.each<[string, Lang, string]>([
    ["twelve teams", "en", "count:12"],
    ["forty-five teams", "en", "count:45"],
    ["ventuno team", "it", "count:21"],
    ["ventotto team", "it", "count:28"],
    ["quarantacinque team", "it", "count:45"],
    ["duecento utenti", "it", "count:200"],
    ["tremila utenti", "it", "count:3000"],
    ["fünfundvierzig Teams", "de", "count:45"],
    ["einundzwanzig Teams", "de", "count:21"],
    ["dreissig Teams", "de", "count:30"],
    ["zweihundert Nutzer", "de", "count:200"],
    ["elftausend Nutzer", "de", "count:11000"],
    ["zweitausendfünfhundert Nutzer", "de", "count:2500"],
    ["hundertzwanzig Alarme", "de", "count:120"],
    ["eine Million Nutzer", "de", "count:1000000"],
    ["ein Dutzend Teams", "de", "count:12"],
    ["centoventi allarmi", "it", "count:120"],
    ["duemilacinquecento utenti", "it", "count:2500"],
    ["trentatré team", "it", "count:33"],
    ["un milione di utenti", "it", "count:1000000"],
    ["mezzo milione di utenti", "it", "count:500000"],
    ["a hundred teams", "en", "count:100"],
    ["one hundred and twenty alerts", "en", "count:120"],
    ["two thousand five hundred events", "en", "count:2500"],
    ["a million users", "en", "count:1000000"],
    ["half a million users", "en", "count:500000"],
    ["two dozen teams", "en", "count:24"],
  ])("reads %j", (text, lang, expected) => {
    expect(read(text, lang)).toEqual([expected]);
  });

  it("ignores articles and words of another language", () => {
    expect(read("ein Team und eine Anwendung", "de")).toEqual([]);
    expect(read("un team e una piattaforma", "it")).toEqual([]);
    expect(read("Sei in the acht", "en")).toEqual([]);
    expect(read("a team in Milano con accento", "it")).toEqual([]);
    expect(read("und Achtung, der Verein", "de")).toEqual([]);
    expect(read("a one-off task and a tool", "en")).toEqual([]);
  });

  it("does not merge separate numbers", () => {
    expect(read("three and four teams")).toEqual(["count:3", "count:4"]);
    expect(read("between two or three teams")).toEqual(["count:2", "count:3"]);
  });
});

describe("dates", () => {
  it.each<[string, string]>([
    ["2021-03", "date:2021-03"],
    ["03/2021", "date:2021-03"],
    ["3.2021", "date:2021-03"],
    ["15.03.2021", "date:2021-03-15"],
    ["2021-03-15", "date:2021-03-15"],
    ["March 2021", "date:2021-03"],
    ["Mar. 2021", "date:2021-03"],
    ["marzo 2021", "date:2021-03"],
    ["März 2021", "date:2021-03"],
    ["15. März 2021", "date:2021-03-15"],
    ["March 15, 2021", "date:2021-03-15"],
    ["since 2021", "date:2021"],
  ])("reads %j", (text, expected) => {
    expect(read(text)).toEqual([expected]);
  });

  it("reads a range of years as two years", () => {
    expect(read("2019–2021")).toEqual(["date:2019", "date:2021"]);
    expect(read("2019-2021")).toEqual(["date:2019", "date:2021"]);
  });
});

describe("backs", () => {
  it.each([
    ["90 minutes", "1.5 hours"],
    ["1800 ms", "1.8 seconds"],
    ["3 years", "36 months"],
    ["1.500 users", "1500 users"],
    ["in 2021", "Date: 2021-03"],
    ["2,000 users", "2000 users"],
    ["two thousand users", "2000 users"],
    ["OAuth2", "Skills used: oauth2"],
    ["K8s", "Skill: Kubernetes (K8s)"],
  ])("accepts %j from %j", (claim, source) => {
    expect(backed(claim, source)).toBe(true);
  });

  it.each([
    ["40%", "40 servers"],
    ["40 servers", "40%"],
    ["8 hours", "8 minutes"],
    ["8 people", "8 minutes"],
    ["CHF 500", "EUR 500"],
    ["CHF 500", "500 users"],
    ["28%", "27%"],
    ["March 2021", "Date: 2021"],
    ["April 2021", "Date: 2021-03"],
    ["3x", "3 services"],
    ["150 users", "1500 users"],
    ["EC2", "AWS"],
    ["improved by ca40%", "40%"],
  ])("rejects %j from %j", (claim, source) => {
    expect(backed(claim, source)).toBe(false);
  });
});
