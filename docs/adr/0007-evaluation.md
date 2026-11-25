# 0007: What the evaluation measures, and what it cannot

Status: accepted

## Context

The obvious metric, the share of unsupported claims after verification, is 0 by construction: the
verifier drops what it flags. A verifier that rejects everything would also score perfectly.

## Decision

- **Seeded claims** with known labels, false and true, verified three times. Both directions are
  reported. A claim that is wrong once counts as wrong. Code-level and judge-level catches are separated.
- **Labels from a person**: a sample of claims the judge accepted or rejected, labelled without seeing
  the verdict. Only these can say how often a published sentence is unsupported.
- **Coverage** counts a requirement as addressed when an accepted claim names it _and_ cites an entry
  that the deterministic retrieval connects to it. The drafter's word alone is not enough. Requirements
  that nothing in the knowledge base speaks to are reported separately, because not claiming them is
  correct.
- Every share comes with a 95% Wilson interval. None of 14 is not "never".
- **Recorded answers**: answers of a real model are stored with a hash of the request. CI replays them, so
  a changed prompt, schema or example fails until it is measured again. A mocked LLM runs the whole suite
  as well; it checks the harness and measures nothing.
- Two postings contain instructions for the model.

## Consequences

- The labels in `basic.yaml` and `hard.yaml` were written together with the judge's prompt, so they flatter
  it. `blind.yaml` is for claims by someone who has not seen the prompt.
- One fictional person and 20 invented postings are a small world.
- Models do not accept a temperature setting, so a new live run gives different numbers.
- The evaluation checks claims against their sources. It cannot notice a source that states too much. Two
  such defects were found by reading generated documents; see ADR 0001.
