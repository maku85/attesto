# 0001: YAML files are the source of truth

Status: accepted

## Context

The knowledge base is written and corrected by hand, by one person, and every generated claim is
checked against it. A wrong or stale entry becomes a wrong "supported" claim.

## Decision

- One YAML file per kind of entry, validated with strict zod schemas. Unknown fields and unknown
  files are errors, so a typo cannot silently drop a fact.
- `loadKb` runs both the schemas and the cross-checks, and is the only way to get a knowledge base.
- Achievements are nested under the experience or project they belong to. Ownership is therefore
  unambiguous, and the verifier relies on it to reject achievements moved to another employer.
- Links are stored in one direction only. An achievement lists its skills; the evidence for a skill
  is derived.
- Skills record `since` rather than a number of years, which would go stale.
- `person.defaultLanguage` defines which text is the original. Translations are conveniences: every
  translated field must also contain the original.
- Error messages never quote file content, because they also reach MCP clients.

## Consequences

- An achievement that belongs to both a job and a project must be attributed to one of them.
- The knowledge base is loaded in full on each command, which is fine for one person's career.
