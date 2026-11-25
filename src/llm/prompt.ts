/** Keeps text from closing the tag that surrounds it in a prompt and posing as instructions. */
export function asData(text: string): string {
  return text.replaceAll("<", "&lt;");
}
