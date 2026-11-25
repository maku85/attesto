# 0006: Templates write everything that is not a claim

Status: accepted

## Context

A CV is mostly copied facts: names, dates, degrees. Asking an LLM to repeat them can only introduce
errors, and would send personal data to it.

## Decision

- Templates turn a document into a list of blocks of lines. Each line has an origin: a verified claim,
  the knowledge base, the posting, or fixed wording. Markdown, HTML and the provenance report are
  produced from the same blocks, so no visible line can be missing from the report.
- The report is built before anything is written, and fails if a claim has no accepted verification of
  exactly its text.
- Language decides wording, spelling and date format. The market decides which personal details are
  customary. Swiss German uses "ss" and no comma after salutation and closing.
- Expired certifications are shown as expired.
- The skills section lists what the posting asks for and every advanced or expert skill still in use, each
  with its level. A list of matches alone showed a basic skill and hid the strongest one.
- All text is escaped, because postings and claims are not trusted. Only http and https addresses become
  links.
- File names contain the run ID and files are never overwritten, since a document may have been edited.
- MCP tools return claims and file paths. Contact details are only in the files.

## Consequences

- Document, report and JSON copy are personal data. They are readable by the owner only.
- Editing the Markdown by hand breaks its link to the report. To check changes, edit the JSON copy and
  run `attesto verify`.
