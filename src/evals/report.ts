import { escapeMarkdown } from "../pipeline/render.ts";
import type { AuditSummary } from "./audit.ts";
import { totalMetrics, type PostingResult } from "./postings.ts";
import type { SeededSummary } from "./seeded.ts";
import { formatRate, type Count } from "./stats.ts";

export type EvalReport = {
  date: string;
  draftModel: string;
  judgeModel: string;
  repeat: number;
  seeded: SeededSummary;
  postings: PostingResult[];
  audit: AuditSummary | undefined;
};

const row = (...cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
const table = (head: string[], rows: string[]) =>
  [row(...head), row(...head.map(() => "--")), ...rows].join("\n");
const add = (counts: Count[]): Count => ({
  hits: counts.reduce((total, { hits }) => total + hits, 0),
  of: counts.reduce((total, { of }) => total + of, 0),
});

/** The short table for the README. */
export function summaryTable({ seeded, postings, audit }: EvalReport): string {
  const total = totalMetrics(postings);
  const accepted = add(seeded.sets.map((set) => set.accepted));
  const recall = { hits: accepted.of - accepted.hits, of: accepted.of };
  const audited = audit && audit.unlabelled === 0 ? audit : undefined;
  return table(
    ["Metric", "Result (95% interval)"],
    [
      row("Seeded false claims caught", formatRate(recall)),
      row(
        "Seeded true claims wrongly rejected",
        formatRate(add(seeded.sets.map((set) => set.rejected))),
      ),
      row(
        "Accepted claims that a person finds unsupported",
        audited ? formatRate(audited.wronglyAccepted) : "not labelled yet",
      ),
      row(
        "Rejected claims that a person finds supported",
        audited ? formatRate(audited.wronglyRejected) : "not labelled yet",
      ),
      row("Numbers in documents without a source", total.numericViolations),
      row(
        "Reachable requirements addressed",
        formatRate({ hits: total.addressed, of: total.reachable }),
      ),
      row(
        "All requirements addressed",
        formatRate({ hits: total.addressed, of: total.requirements }),
      ),
    ],
  );
}

export function fullReport(report: EvalReport): string {
  const { date, draftModel, judgeModel, repeat, seeded, postings } = report;
  const total = totalMetrics(postings);
  const failures = postings.filter((result) => "error" in result);
  return (
    [
      "# Evaluation results",
      `Computed on ${date} from recorded answers. Drafter: ${draftModel}. Judge: ${judgeModel}. Seeded claims verified ${repeat} times; ` +
        "a claim that was wrong once counts as wrong.",
      "## Summary",
      summaryTable(report),
      "The unsupported-claim rate as the verifier sees it is 0 by construction, because it drops what it " +
        "flags. That is why the summary uses labels from a person.",
      "## Seeded claims",
      table(
        ["Set", "False claims accepted", "True claims rejected"],
        seeded.sets.map(({ set, accepted, rejected }) =>
          row(set, formatRate(accepted), formatRate(rejected)),
        ),
      ),
      table(
        ["Kind of false claim", "Caught", "By code", "By the judge"],
        seeded.kinds.map(({ kind, caught, byCode, byJudge }) =>
          row(kind, `${caught.hits}/${caught.of}`, byCode, byJudge),
        ),
      ),
      seeded.wrong.length === 0
        ? "No claim was judged wrongly."
        : table(
            ["Wrongly judged", "Sentence", "Label", "Reason given"],
            seeded.wrong.map(({ id, text, supported, reason }) =>
              row(
                id,
                escapeMarkdown(text),
                supported ? "supported" : "not supported",
                escapeMarkdown(reason) || "–",
              ),
            ),
          ),
      `Verdict changed between repetitions: ${seeded.unstable.join(", ") || "never"}.`,
      "## Documents",
      `${total.drafted} claims drafted, ${total.accepted} accepted, ${total.acceptedAfterRewrite} of them ` +
        `after a rewrite. Rejected at first by structure: ${total.failed.structural}, by numbers: ` +
        `${total.failed.numeric}, by the judge: ${total.failed.entailment}.`,
      ...(failures.length > 0
        ? [`**${failures.length} postings failed:** ${failures.map(({ id }) => id).join(", ")}.`]
        : []),
      table(
        ["Posting", "Type", "Requirements", "Reachable", "Addressed", "Drafted", "Accepted"],
        postings.flatMap((result) =>
          "metrics" in result
            ? [
                row(
                  result.id,
                  result.type,
                  result.metrics.requirements,
                  result.metrics.reachable,
                  result.metrics.addressed,
                  result.metrics.drafted,
                  result.metrics.accepted,
                ),
              ]
            : [],
        ),
      ),
      "A requirement is reachable when some entry speaks to it, according to the deterministic retrieval. " +
        "It is addressed when an accepted claim names it and cites such an entry.",
    ].join("\n\n") + "\n"
  );
}

const START = "<!-- eval:start -->";
const END = "<!-- eval:end -->";

/** Replaces the table between the markers of the README. */
export function updateReadme(readme: string, report: EvalReport): string {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) throw new Error("The README has no eval markers");
  return `${readme.slice(0, start + START.length)}\n\n${summaryTable(report)}\n\n${readme.slice(end)}`;
}
