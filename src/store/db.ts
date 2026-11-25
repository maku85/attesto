import { chmodSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Resolves to the repository's migrations/ from both src/store and dist/store.
const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "migrations");

export function resolveDbPath(): string {
  return process.env.ATTESTO_DB || join(homedir(), ".attesto", "attesto.db");
}

/** Opens the database, readable by its owner only, and applies pending migrations. */
export function openDb(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    // The CLI and the MCP server may use the same file at the same time.
    db.exec("PRAGMA busy_timeout = 5000");
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

function migrate(db: DatabaseSync): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  // Take the write lock before reading the version, so that two processes cannot both migrate.
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (row.user_version > files.length) {
      throw new Error("The database was created by a newer version of attesto");
    }
    for (const file of files.slice(row.user_version)) {
      db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
    db.exec(`PRAGMA user_version = ${files.length}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
