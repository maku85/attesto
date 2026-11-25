import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findBrowser, htmlToPdf, requireBrowser } from "../src/pipeline/pdf.ts";
import { produce, renderRun } from "../src/pipeline/produce.ts";
import { openDb } from "../src/store/db.ts";
import { findRunId, getRun } from "../src/store/runs.ts";
import { PipelineProvider, exampleKb, runRequest } from "./fixtures.ts";

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attesto-pdf-test-"));
  db = openDb(join(dir, "attesto.db"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  db.close();
  rmSync(dir, { recursive: true });
});

const generate = (overrides = {}) =>
  produce({
    ...runRequest(
      db,
      new PipelineProvider({
        draft: [
          ["exp-lagonube-2022", "Cut deployment time to 8 minutes.", ["ach-lagonube-deploy-time"]],
        ],
      }),
    ),
    outDir: join(dir, "out"),
    ...overrides,
  });
const rerender = (runId: string, overrides = {}) =>
  renderRun({ db, kb: exampleKb(), runId, outDir: join(dir, "styled"), ...overrides });

describe("finding a browser", () => {
  it("uses ATTESTO_BROWSER, and does not fall back when it is wrong", () => {
    vi.stubEnv("ATTESTO_BROWSER", process.execPath);
    expect(findBrowser()).toBe(process.execPath);
    vi.stubEnv("ATTESTO_BROWSER", join(dir, "missing"));
    expect(findBrowser()).toBeUndefined();
    expect(() => requireBrowser()).toThrow("ATTESTO_BROWSER");
  });
});

describe("a browser that fails", () => {
  it("does not cost the other files", async () => {
    await expect(generate({ browser: process.execPath })).rejects.toThrow();
    const extensions = readdirSync(join(dir, "out")).map((name) =>
      name.split(".").slice(1).join("."),
    );
    expect(extensions.sort()).toEqual(
      ["document.json", "html", "md", "provenance.json", "provenance.md"].sort(),
    );
  });

  it("leaves no temporary files behind", async () => {
    const temporary = () =>
      readdirSync(tmpdir()).filter((name) => /^attesto-pdf-(?!test)/.test(name));
    const before = temporary();
    await expect(htmlToPdf(process.execPath, "<p>x</p>")).rejects.toThrow();
    expect(temporary()).toEqual(before);
  });
});

describe("rendering a past run", () => {
  it("writes another template without an LLM, and records it", async () => {
    const { document } = await generate();
    const files = await rerender(document.runId, { template: "modern" });
    expect(files.map((file) => basename(file))).toEqual([
      `cv-en-${document.runId.slice(0, 8)}.modern.html`,
    ]);
    const html = readFileSync(files[0]!, "utf8");
    expect(html).toContain("Cut deployment time to 8 minutes.");
    expect(html).toContain("text-transform: uppercase");
    const hashes = Object.keys(getRun(db, document.runId)?.outputHashes ?? {});
    expect(hashes).toEqual(expect.arrayContaining(["md", "document.json", "modern.html"]));
  });

  it("ignores an edited copy of the document", async () => {
    const { document, files } = await generate();
    const copy = files.find((file) => file.endsWith("document.json"))!;
    writeFileSync(copy, readFileSync(copy, "utf8").replace("8 minutes", "1 minute"));
    const [html] = await rerender(document.runId);
    expect(readFileSync(html!, "utf8")).toContain("to 8 minutes.");
  });

  it.each<[string, (id: string) => void]>([
    ["text", (id) => db.prepare("UPDATE verifications SET text = 'x' WHERE run_id = ?").run(id)],
    [
      "decision",
      (id) => db.prepare("UPDATE verifications SET decision = 'dropped' WHERE run_id = ?").run(id),
    ],
  ])("refuses a claim whose stored %s does not match", async (_, tamper) => {
    const { document } = await generate();
    tamper(document.runId);
    await expect(rerender(document.runId)).rejects.toThrow("no accepted verification");
    expect(() => readdirSync(join(dir, "styled"))).toThrow();
  });

  it("stops when an entry behind a claim has changed, but not for others", async () => {
    const { document } = await generate();
    const unrelated = exampleKb();
    unrelated.experiences[0]!.achievements[3]!.statement = "Changed.";
    expect(await rerender(document.runId, { kb: unrelated })).toHaveLength(1);
    const cited = exampleKb();
    cited.experiences[0]!.achievements[0]!.statement = "Changed.";
    await expect(rerender(document.runId, { kb: cited, template: "modern" })).rejects.toThrow(
      "ach-lagonube-deploy-time",
    );
  });

  it("never overwrites, and explains a missing run or document", async () => {
    const { document } = await generate();
    await rerender(document.runId);
    await expect(rerender(document.runId)).rejects.toThrow("already exists");
    await expect(rerender("nope")).rejects.toThrow("No run");
    db.prepare("UPDATE runs SET document = NULL, status = 'failed'").run();
    await expect(rerender(document.runId)).rejects.toThrow("it is failed");
  });

  it("accepts a shortened ID only when it is unique", async () => {
    const { document } = await generate();
    expect(findRunId(db, document.runId.slice(0, 8))).toBe(document.runId);
    expect(() => findRunId(db, "zzz")).toThrow("No run");
    await generate();
    expect(() => findRunId(db, "")).toThrow("More than one");
  });
});

const browser = findBrowser();
describe.skipIf(!browser)("with a real browser", () => {
  it.each(["classic", "modern"] as const)(
    "prints %s as a PDF for the owner only",
    async (template) => {
      const { files } = await generate({ browser, template });
      const pdf = readFileSync(files.at(-1)!);
      expect(basename(files.at(-1)!)).toMatch(/\.pdf$/);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      if (process.platform !== "win32") {
        expect(execFileSync("ls", ["-l", files.at(-1)!], { encoding: "utf8" })).toMatch(
          /^-rw-------/,
        );
      }
    },
    60_000,
  );
});
