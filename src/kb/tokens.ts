/** Lowercase, accent-free words. Keeps `+` and `#` so that C, C++ and C# stay different. */
export function tokenize(text: string): string[] {
  const plain = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return plain.match(/[\p{L}\p{N}]+[+#]*/gu) ?? [];
}

/** Whether `phrase` occurs in `tokens` as consecutive whole words. */
// shortcut: no stemming, so "migrations" does not match "migration"; revisit if evals show misses.
export function containsPhrase(tokens: string[], phrase: string[]): boolean {
  return (
    phrase.length > 0 &&
    tokens.some((_, start) => phrase.every((word, i) => tokens[start + i] === word))
  );
}
