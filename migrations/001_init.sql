-- The knowledge base is never stored here: runs keep entry IDs and content hashes only.
-- Drafts and rendered claims do contain personal data.

CREATE TABLE job_analyses (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  posting     TEXT NOT NULL,
  model       TEXT NOT NULL,
  analysis    TEXT NOT NULL CHECK (json_valid(analysis))
) STRICT;

CREATE TABLE runs (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error           TEXT,
  job_analysis_id TEXT NOT NULL REFERENCES job_analyses (id),
  type            TEXT NOT NULL CHECK (type IN ('cv', 'letter')),
  language        TEXT NOT NULL CHECK (language IN ('it', 'en', 'de')),
  market          TEXT NOT NULL CHECK (market IN ('ch-it', 'ch-en', 'ch-de')),
  as_of           TEXT NOT NULL,
  draft_model     TEXT NOT NULL,
  judge_model     TEXT NOT NULL,
  sources         TEXT NOT NULL CHECK (json_valid(sources)),       -- [{ id, sha256 }]
  document        TEXT CHECK (json_valid(document)),
  output_hashes   TEXT CHECK (json_valid(output_hashes))
) STRICT;

CREATE INDEX runs_created_at ON runs (created_at);

-- One row per claim and attempt, so that rejected wording stays auditable.
CREATE TABLE verifications (
  run_id     TEXT NOT NULL REFERENCES runs (id),
  claim_id   TEXT NOT NULL,
  attempt    INTEGER NOT NULL CHECK (attempt IN (1, 2)),
  text       TEXT NOT NULL,
  sources    TEXT NOT NULL CHECK (json_valid(sources)),
  structural TEXT NOT NULL CHECK (json_valid(structural)),
  numeric    TEXT NOT NULL CHECK (json_valid(numeric)),
  entailment TEXT CHECK (json_valid(entailment)),
  decision   TEXT NOT NULL CHECK (decision IN ('accepted', 'regenerate', 'dropped')),
  PRIMARY KEY (run_id, claim_id, attempt)
) STRICT;

CREATE TABLE eval_runs (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('replay', 'live')),
  draft_model TEXT NOT NULL,
  judge_model TEXT NOT NULL,
  metrics     TEXT CHECK (json_valid(metrics))
) STRICT;

CREATE TABLE eval_results (
  eval_run_id TEXT NOT NULL REFERENCES eval_runs (id),
  case_id     TEXT NOT NULL,
  metrics     TEXT NOT NULL CHECK (json_valid(metrics)),
  PRIMARY KEY (eval_run_id, case_id)
) STRICT;
