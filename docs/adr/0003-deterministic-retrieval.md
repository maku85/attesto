# 0003: Retrieval is deterministic

Status: accepted

## Context

Only entries relevant to the posting are sent to the LLM. The selection decides what a document can
say, so it must be explainable and testable.

## Decision

- The LLM is used once, to turn the posting into requirements with keywords. Scoring is plain code.
- An entry scores for each requirement: in full when it is linked to a skill the keywords name, at
  half weight when the keywords occur in its text. Must-haves weigh twice as much as nice-to-haves.
- Older facts lose relevance gradually, down to a floor.
- Entries that match nothing are not selected, with one exception: a CV gets up to eight achievements of
  the current role, or of the latest one. An early trial left out strong results only because
  the posting did not name them. Letters stay limited to what matches.
- Words are compared whole and without stemming, in every language of the entry.
- Contacts, nationality, work permit and birth date are not part of any entry. An allow-list decides
  what is, so a new personal field stays private until someone adds it there.

## Consequences

- The result depends on the keywords, which the LLM chooses. Analyses are stored, so a retrieval can
  be repeated exactly.
- Inflected forms are missed when the keywords do not include them.
- There is no LLM re-ranking. It is worth adding only if the evaluation shows relevant entries below
  the cut.
