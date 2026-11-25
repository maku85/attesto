import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

function attesto(...args: string[]) {
  return spawnSync(process.execPath, [join(ROOT, "src/cli/main.ts"), ...args], {
    encoding: "utf8",
  });
}

it("validates the example knowledge base", () => {
  const { status, stdout } = attesto("validate", "--kb", join(ROOT, "examples/kb"));
  expect(stdout).toBe("Valid: 4 experiences, 2 projects, 15 achievements, 14 skills\n");
  expect(status).toBe(0);
});

it("exits with 1 and lists the issues of an invalid knowledge base", () => {
  const { status, stdout, stderr } = attesto("validate", "--kb", join(ROOT, "does-not-exist"));
  expect(stderr).toContain("person.yaml: file not found");
  expect(stdout).toBe("");
  expect(status).toBe(1);
});

it.each([[[]], [["unknown"]], [["validate", "--nope"]]])(
  "exits with 2 on wrong usage: %j",
  (args) => {
    const { status, stderr } = attesto(...args);
    expect(stderr).not.toBe("");
    expect(status).toBe(2);
  },
);

it("prints help", () => {
  const { status, stdout } = attesto("--help");
  expect(stdout).toContain("attesto validate");
  expect(status).toBe(0);
});
