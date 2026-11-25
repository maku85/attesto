# 0005: The verifier has three layers and fails closed

Status: accepted

## Context

LLMs improve CVs by inventing. Some inventions can be excluded by code, others need judgement.

## Decision

1. **Structure** (code): one sentence, at least one source, only known sources, only sources allowed
   in that slot. One sentence, because a second could hide behind the sources of the first.
2. **Numbers** (code): every number, date and duration must be stated by a cited source, with the
   same kind of unit: "40%" is not backed by "40 servers". Notations, units and number words are
   normalized in Italian, English and German. Ambiguous notations match any reading.
3. **Meaning** (LLM): a judge sees one sentence and its sources, and nothing else. It does not see the
   posting, so a posting cannot influence it.

Later layers run only when earlier ones pass. Only `supported` is accepted. A rejected claim gets one
rewrite, which goes through all three layers again, and is then dropped. A refusal or an unreadable
answer of the judge counts as unsupported; a lost connection fails the run. Every attempt is stored.

## What this does and does not guarantee

Code blocks unknown sources, sources from the wrong employer, and any number it can read that no cited
source states. Invented meaning is caught by the judge, which can be wrong. Its miss rate and its
false-rejection rate must be measured, and on labels that the judge did not produce.

Left to the judge: "one", vague amounts ("halved", "dozens"), Roman numerals, what a number counts
("8 teams" or "8 services"), and its direction.

## Consequences

- The judge uses the same model as the drafter unless `ATTESTO_JUDGE_MODEL` is set, and may then share
  its blind spots.
- A correct claim can be rejected, for example when it cites the wrong entry. That costs wording, not
  truth.
- A claim that cites many entries has more numbers to match. The judge sees all of them.
