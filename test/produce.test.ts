import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { VerifiableDocument } from "../src/pipeline/document.ts";
import { produce, storedJob } from "../src/pipeline/produce.ts";
import { verifyDocument } from "../src/pipeline/verify/document.ts";
import { openDb } from "../src/store/db.ts";
import { getRun } from "../src/store/runs.ts";
import { PipelineProvider, exampleKb, runRequest } from "./fixtures.ts";

let dir: string;
let db: DatabaseSync;
const provider = () =>
  new PipelineProvider({
    draft: [
      ["exp-lagonube-2022", "Cut deployment time to 8 minutes.", ["ach-lagonube-deploy-time"]],
      ["exp-lagonube-2022", "Cut costs by 90%.", ["ach-lagonube-cloud-cost"]],
    ],
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attesto-produce-"));
  db = openDb(join(dir, "attesto.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
});
const request = (overrides = {}) => ({
  ...runRequest(db, provider()),
  outDir: join(dir, "out"),
  ...overrides,
});

it("writes the document, its report and a verifiable copy, for the owner only", async () => {
  const { document, files } = await produce(request());
  const prefix = `cv-en-${document.runId.slice(0, 8)}`;
  expect(files.map((file) => basename(file))).toEqual(
    ["md", "html", "document.json", "provenance.md", "provenance.json"].map(
      (e) => `${prefix}.${e}`,
    ),
  );
  if (process.platform !== "win32") {
    for (const file of files) expect(statSync(file).mode & 0o777).toBe(0o600);
  }
  expect(readFileSync(files[0]!, "utf8")).toContain("Cut deployment time to 8 minutes.");
  expect(readFileSync(files[0]!, "utf8")).not.toContain("90%");

  const copy = VerifiableDocument.parse(JSON.parse(readFileSync(files[2]!, "utf8")));
  expect(await verifyDocument(copy, exampleKb(), provider(), "judge")).toMatchObject({
    supported: true,
    changedSources: [],
  });
});

it("stores the hashes of what was written", async () => {
  const { document, files } = await produce(request());
  const hash = createHash("sha256").update(readFileSync(files[0]!)).digest("hex");
  expect(getRun(db, document.runId)?.outputHashes).toMatchObject({ md: hash });
});

it("never overwrites an earlier document", async () => {
  await produce(request());
  await produce(request());
  expect(readdirSync(join(dir, "out"))).toHaveLength(10);
});

it("reports progress and passes the tone to the drafter", async () => {
  const steps: string[] = [];
  const fake = new PipelineProvider({
    draft: [["letter-body", "Cut costs by 90%.", ["ach-lagonube-cloud-cost"]]],
  });
  const { document } = await produce(
    request({
      provider: fake,
      type: "letter",
      tone: "warm",
      onProgress: (step: string) => steps.push(step),
    }),
  );
  expect(steps).toEqual(["Drafting", "Verifying 1 claims", "Rewriting 1 claims", "Rendering"]);
  expect(fake.calls[0]?.request.system).toContain("warm tone");
  expect(getRun(db, document.runId)?.tone).toBe("warm");
});

it("finds a stored analysis, and fails for an unknown one", () => {
  const { job } = request();
  expect(storedJob(db, job.id)).toEqual(job);
  expect(() => storedJob(db, "nope")).toThrow("No job analysis");
});
