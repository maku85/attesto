import type { Document } from "../document.ts";

/** What a market expects, apart from the language. */
export type Market = {
  /** Personal details customary on a CV, beyond contact details. */
  personalDetails: ("birthDate" | "nationality" | "workPermit")[];
};

export const MARKET: Record<Document["market"], Market> = {
  "ch-it": { personalDetails: ["birthDate", "nationality", "workPermit"] },
  "ch-de": { personalDetails: ["birthDate", "nationality", "workPermit"] },
  // International employers in Switzerland need to know the permit, but do not expect an age.
  "ch-en": { personalDetails: ["nationality", "workPermit"] },
};
