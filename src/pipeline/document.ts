import { z } from "zod";
import { Lang } from "../kb/schema.ts";

export const DOCUMENT_TYPES = ["cv", "letter"] as const;
export const MARKETS = ["ch-it", "ch-en", "ch-de"] as const;

/** One sentence, the entries it is derived from, and the requirements it answers. */
export const Claim = z.object({
  id: z.string().min(1),
  text: z.string(),
  sources: z.array(z.string()),
  /** Used to measure coverage, never as evidence. */
  addresses: z.array(z.string()).default([]),
});
export type Claim = z.infer<typeof Claim>;

/** A slot is "summary", "letter-body", or the ID of an experience or project. */
export const Section = z.object({ slot: z.string(), claims: z.array(Claim) });

/** The part of a document that can be verified on its own. */
export const VerifiableDocument = z
  .object({
    language: Lang,
    asOf: z.iso.date(),
    sections: z.array(Section),
    sources: z.array(z.object({ id: z.string(), sha256: z.string() })).default([]),
  })
  .refine(
    ({ sections }) => {
      const ids = sections.flatMap(({ claims }) => claims.map(({ id }) => id));
      return new Set(ids).size === ids.length;
    },
    { error: "claim IDs must be unique" },
  );
export type VerifiableDocument = z.infer<typeof VerifiableDocument>;

export type Document = VerifiableDocument & {
  schemaVersion: 1;
  runId: string;
  type: (typeof DOCUMENT_TYPES)[number];
  market: (typeof MARKETS)[number];
};

export type StructuralProblem =
  "empty" | "multiple-sentences" | "no-source" | "unknown-source" | "out-of-scope-source";

export type Verification = {
  claimId: string;
  attempt: 1 | 2;
  text: string;
  sources: string[];
  structural: StructuralProblem[];
  /** Numbers in the claim that no cited source states. */
  numeric: string[];
  /** `null` when an earlier check failed, so the judge was not asked. */
  entailment: Entailment | null;
  decision: "accepted" | "regenerate" | "dropped";
};

export type Entailment = {
  verdict: "supported" | "partially" | "unsupported";
  reason: string;
  model: string;
};
