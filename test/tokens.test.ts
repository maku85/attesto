import { expect, it } from "vitest";
import { containsPhrase, tokenize } from "../src/kb/tokens.ts";

it.each([
  ["Node.js & CI/CD", ["node", "js", "ci", "cd"]],
  ["C, C++ and C#", ["c", "c++", "and", "c#"]],
  ["Zürich, affidabilità", ["zurich", "affidabilita"]],
  ["K8s 27%", ["k8s", "27"]],
  ["", []],
])("tokenizes %j", (text, tokens) => {
  expect(tokenize(text)).toEqual(tokens);
});

it.each([
  ["Apache Kafka streams", "kafka", true],
  ["Apache Kafka streams", "Kafka Streams", true],
  ["Apache Kafka streams", "apache streams", false],
  ["JavaScript", "Java", false],
  ["anything", "", false],
])("looks in %j for %j: %s", (text, phrase, expected) => {
  expect(containsPhrase(tokenize(text), tokenize(phrase))).toBe(expected);
});
