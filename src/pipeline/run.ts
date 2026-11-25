import type { DatabaseSync } from "node:sqlite";
import type { KnowledgeBase } from "../kb/schema.ts";
import { hashSource, listSources, type Source } from "../kb/sources.ts";
import { LlmError, type LlmProvider } from "../llm/provider.ts";
import { completeRun, createRun, failRun } from "../store/runs.ts";
import type { JobAnalysis } from "./analyze.ts";
import type { Document, Tone, Verification } from "./document.ts";
import { draft, redraft, type DraftRequest } from "./draft.ts";
import { retrieve } from "./retrieve.ts";
import { checkClaims, passes, type PlacedClaim, type VerifyContext } from "./verify/index.ts";

export type RunRequest = {
  db: DatabaseSync;
  provider: LlmProvider;
  draftModel: string;
  judgeModel: string;
  kb: KnowledgeBase;
  job: { id: string; analysis: JobAnalysis };
  type: Document["type"];
  language: Document["language"];
  market: Document["market"];
  /** The day the document is written, as YYYY-MM-DD. */
  asOf: string;
  /** Whether rejected claims get one rewrite before they are dropped. */
  regenerate?: boolean;
  /** For letters. */
  tone?: Tone;
  /** Called at the start of each step, which can take a while. */
  onProgress?: (step: string) => void;
};

export type RunResult = { document: Document; verifications: Verification[] };

/** Retrieves, drafts and verifies. The run is stored before the first LLM call. */
export async function generateDocument(request: RunRequest): Promise<RunResult> {
  const { db, provider, kb, job, type, language, market, asOf } = request;
  const { defaultLanguage } = kb.person;
  const ids = selectSources(request);
  if (ids.size === 0) throw new Error("No entry of the knowledge base matches the posting");
  const inLanguage = (lang: Document["language"]) =>
    listSources(kb, asOf, lang).filter(({ id }) => ids.has(id));

  const originals = inLanguage(defaultLanguage);
  const sources = originals.map((source) => ({ id: source.id, sha256: hashSource(source) }));
  const runId = createRun(db, {
    jobAnalysisId: job.id,
    type,
    language,
    market,
    asOf,
    draftModel: request.draftModel,
    judgeModel: request.judgeModel,
    tone: request.tone ?? null,
    sources,
  });

  try {
    const { accepted, verifications } = await draftAndVerify(
      {
        provider,
        model: request.draftModel,
        type,
        language,
        analysis: job.analysis,
        sources: inLanguage(language),
        tone: request.tone,
      },
      {
        provider,
        judgeModel: request.judgeModel,
        language,
        sources: new Map(originals.map((source) => [source.id, source])),
        sourceLanguage: defaultLanguage,
      },
      request.regenerate ?? true,
      request.onProgress,
    );
    const slots = [...new Set(accepted.map(({ slot }) => slot))];
    const document: Document = {
      schemaVersion: 1,
      runId,
      type,
      language,
      market,
      asOf,
      sources,
      sections: slots.map((slot) => ({
        slot,
        claims: accepted.filter((placed) => placed.slot === slot).map(({ claim }) => claim),
      })),
    };
    completeRun(db, document, verifications);
    return { document, verifications };
  } catch (error) {
    failRun(db, runId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** The entries that match the posting, the context they belong to, and what follows from dates. */
function selectSources({ kb, job, type, asOf }: RunRequest): Set<string> {
  const matched = new Set(retrieve(kb, job.analysis, { asOf }).map(({ id }) => id));
  if (matched.size === 0) return matched;
  const all = listSources(kb, asOf, kb.person.defaultLanguage);
  const owners = new Set(
    all.filter(({ id }) => matched.has(id)).flatMap(({ ownerId }) => ownerId ?? []),
  );
  const selected = (source: Source) =>
    matched.has(source.id) ||
    owners.has(source.id) ||
    source.id === "drv-total-experience" ||
    (source.type === "derived" &&
      (owners.has(source.ownerId ?? "") || matched.has(source.id.replace(/^drv-/, "")))) ||
    (source.type === "statement" && type === "letter");
  return new Set(all.filter(selected).map(({ id }) => id));
}

async function draftAndVerify(
  request: DraftRequest,
  context: VerifyContext,
  regenerate: boolean,
  onProgress: RunRequest["onProgress"],
): Promise<{ accepted: PlacedClaim[]; verifications: Verification[] }> {
  onProgress?.("Drafting");
  const drafted = await draft(request);
  onProgress?.(`Verifying ${drafted.length} claims`);
  const first = await checkClaims(drafted, context);
  const rejected = first.filter(({ checks }) => !passes(checks));
  if (regenerate && rejected.length > 0) onProgress?.(`Rewriting ${rejected.length} claims`);
  const rewritten = regenerate && rejected.length > 0 ? await tryRedraft(request, rejected) : [];
  const second = await checkClaims(rewritten, context);
  const retried = new Map(second.map((result) => [result.placed.claim.id, result]));

  const accepted: PlacedClaim[] = [];
  const verifications: Verification[] = [];
  const record = (
    { placed: { claim }, checks }: (typeof first)[number],
    attempt: 1 | 2,
    decision: Verification["decision"],
  ) =>
    verifications.push({
      claimId: claim.id,
      attempt,
      text: claim.text,
      sources: claim.sources,
      ...checks,
      decision,
    });

  for (const result of first) {
    const retry = retried.get(result.placed.claim.id);
    if (passes(result.checks)) {
      record(result, 1, "accepted");
      accepted.push(result.placed);
    } else if (!retry) {
      record(result, 1, "dropped");
    } else {
      record(result, 1, "regenerate");
      record(retry, 2, passes(retry.checks) ? "accepted" : "dropped");
      if (passes(retry.checks)) accepted.push(retry.placed);
    }
  }
  return { accepted, verifications };
}

/** Without a usable rewrite the rejected claims are dropped; the accepted ones still stand. */
async function tryRedraft(...args: Parameters<typeof redraft>): Promise<PlacedClaim[]> {
  try {
    return await redraft(...args);
  } catch (error) {
    if (error instanceof LlmError) return [];
    throw error;
  }
}
