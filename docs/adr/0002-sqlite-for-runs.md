# 0002: SQLite stores runs

Status: accepted. Replaces PostgreSQL in the original plan.

## Context

Runs, verification results and evaluation results must survive the process. attesto is a local tool
for one person, used by a CLI and an MCP server that may run at the same time.

## Decision

Use the SQLite module built into Node.js (`node:sqlite`) with plain SQL migrations, tracked by
`PRAGMA user_version`. A busy timeout lets the CLI and the MCP server share the file. WAL mode is not
used: two processes switching a new file to WAL at once can fail despite the timeout, and the write
volume does not need it.

The knowledge base is not copied into it: a run keeps the IDs and content hashes of its entries.
Drafts, rejected claims and postings are stored, and they do contain personal data, so the file is
readable by its owner only.

## Consequences

- No server, Docker or database dependency is needed.
- Node.js 22 still marks `node:sqlite` as experimental and prints a warning to stderr. MCP uses
  stdout, so the warning is harmless.
- If an entry changes after a run, the run can show that it changed but not its old content.
