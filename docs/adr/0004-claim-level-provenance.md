# 0004: Provenance is per sentence

Status: accepted

## Context

A source list at the end of a document proves nothing about a single sentence. And not every sentence
of an application is a claim about the candidate: "I am writing to apply for…" has no source.

## Decision

- The LLM writes only sentences about the candidate. Each is an object with the IDs it draws on.
  Salutations, headings, dates, skill lists and contacts are rendered by templates.
- Source and slot IDs are enums in the output schema of each request, and are checked again by code.
- A slot limits what may be cited. Text under an employer may cite only that employer's entries, and
  a statement of motivation can be cited only in a letter.
- The posting is never a source. Otherwise "5 years of Kubernetes" could cite the requirement that
  asks for it. A claim may name the requirements it answers; the judge then sees their text as context,
  so a sentence can say what the employer is looking for. Numbers are checked against the candidate's
  entries only, so a number from the posting is never accepted.
- The drafter is asked to persuade: choose, order, connect to the posting and sum up. It may not add
  facts. A first version asked for plain sentences, and the documents read as copies of the entries.
- Sources are rendered as lines of text. The drafter, the number check and the judge all use this
  text. The drafter sees translations where they exist; the checks always use the originals.
- Durations are derived from dates by code and are sources of their own, so "3 years" can be cited.
  They are rounded down.

## Consequences

- A letter can say why the candidate fits what the company asks for, but not what the company is.
- A sentence that combines two employers is possible only in the summary and in letters.
