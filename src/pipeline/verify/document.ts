import { hashSource, listSources } from "../../kb/sources.ts";
import type { KnowledgeBase } from "../../kb/schema.ts";
import type { LlmProvider } from "../../llm/provider.ts";
import type { Verification, VerifiableDocument } from "../document.ts";
import { checkClaims, passes } from "./index.ts";

export type DocumentReport = {
  supported: boolean;
  /** Entries that changed or disappeared since the document was generated. */
  changedSources: string[];
  verifications: Verification[];
};

/** Verifies a stored or edited document against the knowledge base as it is now. */
export async function verifyDocument(
  document: VerifiableDocument,
  kb: KnowledgeBase,
  provider: LlmProvider,
  judgeModel: string,
): Promise<DocumentReport> {
  const { defaultLanguage } = kb.person;
  const sources = new Map(
    listSources(kb, document.asOf, defaultLanguage).map((source) => [source.id, source]),
  );
  const results = await checkClaims(
    document.sections.flatMap(({ slot, claims }) => claims.map((claim) => ({ slot, claim }))),
    {
      provider,
      judgeModel,
      language: document.language,
      sources,
      sourceLanguage: defaultLanguage,
    },
  );
  const verifications = results.map(({ placed: { claim }, checks }): Verification => ({
    claimId: claim.id,
    attempt: 1,
    text: claim.text,
    sources: claim.sources,
    ...checks,
    decision: passes(checks) ? "accepted" : "dropped",
  }));
  return {
    supported: verifications.every(({ decision }) => decision === "accepted"),
    changedSources: changedSources(document.sources, kb, document.asOf),
    verifications,
  };
}

export function changedSources(
  recorded: { id: string; sha256: string }[],
  kb: KnowledgeBase,
  asOf: string,
): string[] {
  const current = new Map(
    listSources(kb, asOf, kb.person.defaultLanguage).map((source) => [
      source.id,
      hashSource(source),
    ]),
  );
  return recorded.filter(({ id, sha256 }) => current.get(id) !== sha256).map(({ id }) => id);
}
