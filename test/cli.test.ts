import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { EXAMPLE_KB, ROOT } from "./fixtures.ts";

function attesto(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", join(ROOT, "src/cli/main.ts"), ...args],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
}

it("validates the example knowledge base", () => {
  const { status, stdout, stderr } = attesto(["validate", "--kb", EXAMPLE_KB]);
  expect(stdout).toBe("Valid: 4 experiences, 2 projects, 15 achievements, 14 skills\n");
  expect(stderr).toBe("");
  expect(status).toBe(0);
});

it.each([
  ["validate", []],
  ["search", ["kafka"]],
  ["get", ["skl-kafka"]],
])("%s exits with 1 and lists the issues of an invalid knowledge base", (command, args) => {
  const { status, stdout, stderr } = attesto([command, ...args, "--kb", join(ROOT, "missing")]);
  expect(stderr).toContain("person.yaml: file not found");
  expect(stdout).toBe("");
  expect(status).toBe(1);
});

it("searches with filters", () => {
  const { stdout } = attesto([
    "search",
    "kubernetes",
    "--type",
    "skill",
    "--type",
    "project",
    "--kb",
    EXAMPLE_KB,
  ]);
  expect(stdout).toBe("1.00  prj-kubeledger  kubeledger\n1.00  skl-kubernetes  Kubernetes\n");
});

it("prints one entry as JSON", () => {
  const { stdout } = attesto(["get", "ach-cantiere-ci", "--kb", EXAMPLE_KB]);
  expect(JSON.parse(stdout)).toMatchObject({ ownerId: "exp-cantiere-2017" });
});

it("exits with 1 for an unknown entry", () => {
  const { status, stderr } = attesto(["get", "ach-nope", "--kb", EXAMPLE_KB]);
  expect(stderr).toBe("No entry has the ID ach-nope\n");
  expect(status).toBe(1);
});

it("rejects an empty posting before calling the LLM", () => {
  const dir = mkdtempSync(join(tmpdir(), "attesto-cli-"));
  const posting = join(dir, "posting.txt");
  writeFileSync(posting, "\n");
  const { status, stderr } = attesto(["analyze", posting], {
    ATTESTO_DB: join(dir, "attesto.db"),
    ANTHROPIC_API_KEY: "unused",
  });
  expect(stderr).toBe("The job posting is empty\n");
  expect(status).toBe(1);
  expect(existsSync(join(dir, "attesto.db"))).toBe(true);
  rmSync(dir, { recursive: true });
});

it.each([
  [[]],
  [["unknown"]],
  [["toString"]],
  [["validate", "--nope"]],
  [["get"]],
  [["get", "a", "b"]],
  [["analyze"]],
  [["verify"]],
  [["runs"]],
  [["runs", "show"]],
  [["runs", "list", "x"]],
  [["search", "x", "--type", "nope"]],
])("exits with 2 on wrong usage: %j", (args) => {
  const { status, stderr } = attesto(args);
  expect(stderr).toContain("Usage:");
  expect(status).toBe(2);
});

it("lists no runs in a new database, and fails for an unknown one", () => {
  const dir = mkdtempSync(join(tmpdir(), "attesto-cli-"));
  const env = { ATTESTO_DB: join(dir, "attesto.db") };
  expect(attesto(["runs", "list"], env)).toMatchObject({ status: 0, stdout: "" });
  expect(attesto(["runs", "show", "nope"], env)).toMatchObject({
    status: 1,
    stderr: "No run has the ID nope\n",
  });
  rmSync(dir, { recursive: true });
});

it("rejects a file that is not an attesto document", () => {
  const { status, stderr } = attesto(["verify", join(ROOT, "package.json"), "--kb", EXAMPLE_KB]);
  expect(stderr).toContain("is not an attesto document");
  expect(status).toBe(1);
});

it("prints help", () => {
  const { status, stdout } = attesto(["--help"]);
  expect(stdout).toContain("attesto validate");
  expect(status).toBe(0);
});
