/**
 * A document as a list of blocks. Every visible line carries its origin, so that the provenance
 * report covers the parts written by templates too.
 */
export type Line = {
  text: string;
  /** "claim" was written by the LLM and verified; "kb" is copied; "fixed" is template wording. */
  origin: "claim" | "kb" | "posting" | "fixed";
  sources: string[];
  claimId?: string;
};

export type Block =
  | { kind: "title" | "subtitle" | "heading"; line: Line }
  | { kind: "entry"; title: Line; meta?: Line }
  | { kind: "details"; rows: { label: string; line: Line }[] }
  /** "lines" keeps each line on its own, as in an address. */
  | { kind: "paragraph" | "lines" | "bullets"; lines: Line[] }
  | { kind: "photo"; line: Line };

export const fixed = (text: string): Line => ({ text, origin: "fixed", sources: [] });
export const fromKb = (text: string, ...sources: string[]): Line => ({
  text,
  origin: "kb",
  sources,
});

export function linesOf(blocks: Block[]): Line[] {
  return blocks.flatMap((block) => {
    switch (block.kind) {
      case "entry":
        return block.meta ? [block.title, block.meta] : [block.title];
      case "details":
        return block.rows.map(({ line }) => line);
      case "paragraph":
      case "lines":
      case "bullets":
        return block.lines;
      default:
        return [block.line];
    }
  });
}
