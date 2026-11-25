import type { KnowledgeBase } from "../kb/schema.ts";
import { listSources } from "../kb/sources.ts";
import type { Document, Verification } from "./document.ts";
import { escapeMarkdown } from "./render.ts";
import { linesOf, type Block, type Line } from "./templates/layout.ts";

export type ProvenanceReport = {
  runId: string;
  type: Document["type"];
  language: Document["language"];
  market: Document["market"];
  asOf: string;
  /** Every visible line, in order. Claims carry the checks that let them through. */
  lines: (Line & { verification?: Verification })[];
  /** Every sentence that was rejected, including those that were then rewritten. */
  rejected: Verification[];
  /** What the cited entries state, in the original language. */
  sources: { id: string; facts: string[] }[];
};

export function buildReport(
  { runId, type, language, market, asOf }: Document,
  blocks: Block[],
  verifications: Verification[],
  kb: KnowledgeBase,
): ProvenanceReport {
  const accepted = new Map(
    verifications
      .filter(({ decision }) => decision === "accepted")
      .map((verification) => [verification.claimId, verification]),
  );
  const lines = linesOf(blocks).map((line) => {
    const verification = line.claimId ? accepted.get(line.claimId) : undefined;
    if (line.origin === "claim" && verification?.text !== line.text) {
      throw new Error(`${line.claimId} has no accepted verification of its text`);
    }
    return verification ? { ...line, verification } : line;
  });
  const cited = new Set(
    lines.filter(({ origin }) => origin === "claim").flatMap(({ sources }) => sources),
  );
  return {
    runId,
    type,
    language,
    market,
    asOf,
    lines,
    rejected: verifications.filter(({ decision }) => decision !== "accepted"),
    sources: listSources(kb, asOf, kb.person.defaultLanguage)
      .filter(({ id }) => cited.has(id))
      .map(({ id, facts }) => ({ id, facts })),
  };
}

const ORIGIN: Record<Line["origin"], string> = {
  claim: "verified",
  kb: "copied from the knowledge base",
  posting: "from the job posting",
  fixed: "template wording",
};

export function reportToMarkdown(report: ProvenanceReport): string {
  const claims = report.lines.filter(({ origin }) => origin === "claim");
  const row = (...cells: string[]) => `| ${cells.join(" | ")} |`;
  const ids = (sources: string[]) => sources.map((id) => `\`${id}\``).join(", ") || "–";
  return (
    [
      "# Provenance report",
      `Run \`${report.runId}\`: ${report.type}, ${report.language}, ${report.market}, ${report.asOf}.\n` +
        `${claims.length} verified claims, ${report.rejected.length} rejected sentences.`,
      "## Document",
      [
        row("#", "Line", "Sources", "Result"),
        row("--", "--", "--", "--"),
        ...report.lines.map(({ text, origin, sources, verification }, i) =>
          row(
            String(i + 1),
            escapeMarkdown(text),
            ids(sources),
            verification
              ? `${ORIGIN.claim} on attempt ${verification.attempt}: ${escapeMarkdown(verification.entailment?.reason ?? "")}`
              : ORIGIN[origin],
          ),
        ),
      ].join("\n"),
      "## Rejected sentences",
      report.rejected.length === 0
        ? "None."
        : [
            row("Claim", "Sentence", "Sources", "Why", "Then"),
            row("--", "--", "--", "--", "--"),
            ...report.rejected.map((verification) =>
              row(
                `${verification.claimId}, attempt ${verification.attempt}`,
                escapeMarkdown(verification.text),
                // Not necessarily IDs: a rejected claim may cite anything.
                escapeMarkdown(verification.sources.join(", ")) || "–",
                escapeMarkdown(reasons(verification)),
                verification.decision === "regenerate" ? "rewritten" : "dropped",
              ),
            ),
          ].join("\n"),
      "## Cited entries",
      ...report.sources.map(
        ({ id, facts }) =>
          `### \`${id}\`\n\n${facts.map((fact) => `- ${escapeMarkdown(fact)}`).join("\n")}`,
      ),
    ].join("\n\n") + "\n"
  );
}

function reasons({ structural, numeric, entailment }: Verification): string {
  return [
    ...structural,
    ...numeric.map((raw) => `no cited source states ${raw}`),
    ...(entailment ? [`${entailment.verdict}: ${entailment.reason}`] : []),
  ].join("; ");
}
