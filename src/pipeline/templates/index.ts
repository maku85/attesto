import type { KnowledgeBase } from "../../kb/schema.ts";
import type { JobAnalysis } from "../analyze.ts";
import type { Document } from "../document.ts";
import { cvTemplate } from "./cv.ts";
import type { Block } from "./layout.ts";
import { letterTemplate } from "./letter.ts";

export type TemplateInput = {
  document: Document;
  kb: KnowledgeBase;
  analysis: JobAnalysis;
  /** Whether a CV leaves room for a photo. */
  photo: boolean;
};

export function layOut(input: TemplateInput): Block[] {
  return input.document.type === "cv" ? cvTemplate(input) : letterTemplate(input);
}
