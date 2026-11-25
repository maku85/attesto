export type Count = { hits: number; of: number };

/** The share with its 95% Wilson interval: small samples prove little, and zero is not "never". */
export function formatRate({ hits, of }: Count): string {
  if (of === 0) return "–";
  const [low, high] = wilson(hits, of);
  return `${hits}/${of} = ${percent(hits / of)} (${percent(low)}–${percent(high)})`;
}

export function wilson(hits: number, of: number): [number, number] {
  const z = 1.96;
  const p = hits / of;
  const center = p + z ** 2 / (2 * of);
  const spread = z * Math.sqrt((p * (1 - p)) / of + z ** 2 / (4 * of ** 2));
  const scale = 1 + z ** 2 / of;
  return [Math.max(0, (center - spread) / scale), Math.min(1, (center + spread) / scale)];
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1).replace(/\.0$/, "")}%`;
}
