import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openDb } from "../src/store/db.ts";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attesto-db-"));
  path = join(dir, "nested", "attesto.db");
});
afterEach(() => rmSync(dir, { recursive: true }));

it("creates the schema once and keeps data when reopened", () => {
  const db = openDb(path);
  db.prepare(
    "INSERT INTO job_analyses VALUES ('job-1', '2026-01-01', 'text', 'model', '{}')",
  ).run();
  db.close();
  const reopened = openDb(path);
  expect(reopened.prepare("SELECT id FROM job_analyses").all()).toHaveLength(1);
  reopened.close();
});

it.skipIf(process.platform === "win32")("makes the database private to its owner", () => {
  const db = openDb(path);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(statSync(join(dir, "nested")).mode & 0o777).toBe(0o700);
  db.close();
});

it("enforces JSON columns and foreign keys", () => {
  const db = openDb(path);
  expect(() =>
    db.exec("INSERT INTO job_analyses VALUES ('job-1', '2026-01-01', 'text', 'model', 'nope')"),
  ).toThrow(/CHECK/);
  expect(() => db.exec("INSERT INTO eval_results VALUES ('missing', 'case', '{}')")).toThrow(
    /FOREIGN KEY/,
  );
  db.close();
});

it("refuses a database from a newer version", () => {
  openDb(path).close();
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA user_version = 999");
  raw.close();
  expect(() => openDb(path)).toThrow(/newer version/);
});

it("survives several processes creating and writing the same database", async () => {
  const module = join(import.meta.dirname, "..", "src", "store", "db.ts");
  const script = `
    import { openDb } from ${JSON.stringify(module)};
    const db = openDb(${JSON.stringify(path)});
    const insert = db.prepare("INSERT INTO job_analyses VALUES (?, '2026-01-01', 'text', 'model', '{}')");
    for (let i = 0; i < 50; i++) insert.run(process.pid + "-" + i);
  `;
  const runs = Array.from({ length: 6 }, () => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script]);
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    return new Promise((resolve) => {
      child.on("close", (code) => resolve({ code, stderr: code === 0 ? "" : stderr }));
    });
  });
  expect(await Promise.all(runs)).toEqual(runs.map(() => ({ code: 0, stderr: "" })));
  const db = openDb(path);
  expect(db.prepare("SELECT count(*) AS n FROM job_analyses").get()).toEqual({ n: 300 });
  db.close();
}, 30_000);
