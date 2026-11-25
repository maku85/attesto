import type { Lang } from "./schema.ts";

/**
 * Finds the numbers in a text, in a form that can be compared across languages and notations.
 * Vague amounts ("halved", "dozens", "one year") are left to the entailment check.
 */
export type QuantityKind = "percent" | "money" | "duration" | "factor" | "date" | "count" | "name";
export type Quantity = {
  raw: string;
  kind: QuantityKind;
  /** More than one when the notation is ambiguous: "1.500" is 1500 in German and 1.5 in English. */
  values: string[];
};

export function extractQuantities(text: string, lang: Lang): Quantity[] {
  const found: Quantity[] = [];
  let rest = wordsToDigits(normalize(text), lang);
  rest = take(rest, DATE_PATTERNS, found);
  rest = takeNames(rest, found);
  takeNumbers(rest, found);
  return found;
}

/** Whether a source that states `source` backs a claim that states `claim`. */
export function backs(source: Quantity, claim: Quantity): boolean {
  const same = source.values.some((value) => claim.values.includes(value));
  if (source.kind === claim.kind) {
    // A source may be more precise than the claim: 2021-03 backs "in 2021".
    const coarser = (value: string) =>
      source.values.some((precise) => precise.startsWith(`${value}-`));
    return same || (claim.kind === "date" && claim.values.some(coarser));
  }
  // A bare 2000 may be a year or a count.
  const kinds = [source.kind, claim.kind];
  return same && kinds.includes("date") && kinds.includes("count");
}

function normalize(text: string): string {
  return (
    text
      // Invisible characters could split a number.
      .replace(/\p{Cf}/gu, "")
      // NFKC would turn these into plain spaces, so group the digits first.
      .replace(/(?<=\d)[\u00a0\u2009\u202f](?=\d{3}(?!\d))/g, "'")
      .normalize("NFKC")
      .replace(/[’‘]/g, "'")
      .replace(/per\s+cent(?:o)?(?!\p{L})/giu, "%")
      .replace(/(?<!\p{L})(CHF|EUR|USD|GBP|Fr\.)(?=\d)/giu, "$1 ")
  );
}

// --- Number words ---------------------------------------------------------------------------

const UNITS = {
  it: "uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici quattordici quindici sedici diciassette diciotto diciannove",
  en: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen",
  de: "ein zwei drei vier fünf sechs sieben acht neun zehn elf zwölf dreizehn vierzehn fünfzehn sechzehn siebzehn achtzehn neunzehn",
};
const TENS = {
  it: "venti trenta quaranta cinquanta sessanta settanta ottanta novanta",
  en: "twenty thirty forty fifty sixty seventy eighty ninety",
  de: "zwanzig dreißig vierzig fünfzig sechzig siebzig achtzig neunzig",
};

function morphemes(lang: Lang, extra: [string, number][]): Map<string, number> {
  return new Map([
    ...UNITS[lang].split(" ").map((word, i): [string, number] => [word, i + 1]),
    ...TENS[lang].split(" ").map((word, i): [string, number] => [word, (i + 2) * 10]),
    ...extra,
  ]);
}

const MORPHEMES = {
  it: morphemes("it", [
    ["cento", 100],
    ["mille", 1000],
    ["mila", 1000],
    // The final vowel drops before uno and otto: ventuno, ventotto.
    ...TENS.it.split(" ").map((word, i): [string, number] => [word.slice(0, -1), (i + 2) * 10]),
  ]),
  en: morphemes("en", [
    ["a", 1],
    ["and", 0],
    ["hundred", 100],
    ["thousand", 1000],
  ]),
  de: morphemes("de", [
    ["und", 0],
    ["dreissig", 30],
    ["hundert", 100],
    ["tausend", 1000],
  ]),
};

const anyOf = (words: Iterable<string>) => [...words].sort((a, b) => b.length - a.length).join("|");

/** Italian and German write a number as one word, English as several. */
const COMPOUND = {
  it: new RegExp(`^(?:${anyOf(MORPHEMES.it.keys())})+$`, "iu"),
  de: new RegExp(`^(?:${anyOf(MORPHEMES.de.keys())})+$`, "iu"),
};
const EN_UNIT = anyOf(UNITS.en.split(" "));
const EN_BELOW_100 = `(?:(?:${anyOf(TENS.en.split(" "))})(?:[\\s-](?:${EN_UNIT}))?|${EN_UNIT})`;
const EN_BELOW_1000 = `(?:(?:${EN_BELOW_100}|a)[\\s-]hundred(?:\\s(?:and\\s)?${EN_BELOW_100})?|${EN_BELOW_100})`;
const EN_NUMBER = new RegExp(
  `(?<!\\p{L})(?:${EN_BELOW_1000}|a)\\sthousand(?:\\s(?:and\\s)?${EN_BELOW_1000})?(?!\\p{L})|(?<!\\p{L})${EN_BELOW_1000}(?!\\p{L})`,
  "giu",
);
const MAGNITUDE = "(?=(?:million|milion|billion|milliard|miliard|dozen|dozzin|dutzend))";
const HALF = new RegExp(`(?<!\\p{L})(?:half an?|mezzo|(?:eine )?halbe)\\s+${MAGNITUDE}`, "giu");
const ONE = new RegExp(
  `(?<!\\p{L})(?:one|an?|un|una|uno|ein|eine|einem|einer)\\s+${MAGNITUDE}`,
  "giu",
);

function valueOf(words: string, lang: Lang): number {
  let total = 0;
  let current = 0;
  for (const [word] of words
    .toLowerCase()
    .matchAll(new RegExp(anyOf(MORPHEMES[lang].keys()), "gu"))) {
    const value = MORPHEMES[lang].get(word) ?? 0;
    if (value === 100) current = (current || 1) * 100;
    else if (value === 1000) {
      total += (current || 1) * 1000;
      current = 0;
    } else current += value;
  }
  return total + current;
}

/** "three-year" becomes "3-year" and "dreijährig" becomes "3 jährig". */
function wordsToDigits(text: string, lang: Lang): string {
  const prepared = text.replace(HALF, "0.5 ").replace(ONE, "1 ");
  // "One" on its own stays a word: in Italian and German it is also an article.
  const digits = (words: string) => {
    const value = valueOf(words, lang);
    return value > 1 ? String(value) : undefined;
  };
  if (lang === "en") return prepared.replace(EN_NUMBER, (match) => digits(match) ?? match);
  const compound = (word: string) => (COMPOUND[lang].test(word) ? digits(word) : undefined);
  return prepared.replace(/\p{L}+/gu, (word) => {
    const plain = lang === "it" ? word.replace(/é$/u, "e") : word;
    const adjective = /^(\p{L}+?)((?:jähr|monat|wöch|täg|stünd|minüt)ig\p{L}*|fach\p{L}*)$/iu.exec(
      word,
    );
    const prefix = adjective?.[1] && compound(adjective[1]);
    return compound(plain) ?? (prefix ? `${prefix} ${adjective?.[2]}` : word);
  });
}

// --- Dates ----------------------------------------------------------------------------------

const MONTHS = [
  "january januar gennaio jan gen",
  "february februar febbraio feb",
  "march märz marzo mar",
  "april aprile apr",
  "may mai maggio mag",
  "june juni giugno jun giu",
  "july juli luglio jul lug",
  "august agosto aug ago",
  "september settembre sep sept set",
  "october oktober ottobre oct okt ott",
  "november novembre nov",
  "december dezember dicembre dec dez dic",
];
const MONTH_NUMBER = new Map(
  MONTHS.flatMap((names, i) => names.split(" ").map((name) => [name, i + 1] as const)),
);
const MONTH = `(?<month>${[...MONTH_NUMBER.keys()].sort((a, b) => b.length - a.length).join("|")})\\.?`;
const YEAR = "(?<year>(?:19|20)\\d\\d)";
const NUMERIC_MONTH = "(?<mm>0?[1-9]|1[0-2])";
const DAY = "(?<day>0?[1-9]|[12]\\d|3[01])";
const START = "(?<![\\p{L}\\p{N}]|\\p{N}[.,'/-])";
const END = "(?![\\p{L}\\p{N}]|[.,'/]\\p{N})";

const DATE_PATTERNS = [
  `${YEAR}[-/](?<mm>0[1-9]|1[0-2])[-/]${DAY}`,
  `${YEAR}[-/](?<mm>0[1-9]|1[0-2])`,
  `${DAY}[./]${NUMERIC_MONTH}[./]${YEAR}`,
  `${NUMERIC_MONTH}[./]${YEAR}`,
  `${DAY}\\.?\\s+${MONTH}\\s+${YEAR}`,
  `${MONTH}\\s+${DAY},?\\s+${YEAR}`,
  `${MONTH}\\s+${YEAR}`,
].map((source) => new RegExp(START + source + END, "giu"));

function take(text: string, patterns: RegExp[], found: Quantity[]): string {
  let rest = text;
  for (const pattern of patterns) {
    rest = rest.replace(pattern, (...args: unknown[]) => {
      const raw = args[0] as string;
      const { year, mm, month, day } = args.at(-1) as Record<string, string | undefined>;
      const parts = [mm ?? String(MONTH_NUMBER.get(month?.toLowerCase() ?? "")), day];
      const padded = parts
        .filter((part) => part !== undefined)
        .map((part) => part.padStart(2, "0"));
      found.push({ raw, kind: "date", values: [[year, ...padded].join("-")] });
      return " | ";
    });
  }
  return rest;
}

// --- Names that contain digits ---------------------------------------------------------------

/** Names such as S3 or OAuth2 must occur in the source as they are. This also catches "ca40%". */
function takeNames(text: string, found: Quantity[]): string {
  return text.replace(/(?<![\p{L}\p{N}])\p{L}+\p{N}[\p{L}\p{N}]*(?:[.,]\p{N}+)*/gu, (raw) => {
    found.push({ raw, kind: "name", values: [raw.toLowerCase()] });
    return " | ";
  });
}

// --- Numbers and their units -----------------------------------------------------------------

const NOT_IN_WORD = "(?![\\p{L}\\p{N}])";
const unit = (words: string) => new RegExp(`^\\+?[\\s-]*(?:${words})${NOT_IN_WORD}`, "iu");

const MULTIPLIERS: [RegExp, number][] = [
  [new RegExp(`^k${NOT_IN_WORD}`, "iu"), 1e3],
  [new RegExp(`^M${NOT_IN_WORD}`, "u"), 1e6],
  [unit("hundred|hundert|cento"), 1e2],
  [unit("thousand|tausend|mila"), 1e3],
  [unit("dozen|dutzend|dozzin[ae]"), 12],
  [unit("million(?:s|en|i)?|milion[ei]|mio\\.?|mln\\.?"), 1e6],
  [unit("billions?|milliarden?|miliard[oi]|mrd\\.?"), 1e9],
];
const PERCENT = /^\+?[\s-]*(?:%|percent(?:o|age)?(?!\p{L})|prozent)/iu;
const FACTOR = new RegExp(
  `^(?:[\\s-]*(?:x|×|times|fold|fach\\p{L}*|volte|mal))${NOT_IN_WORD}`,
  "iu",
);
const CURRENCIES: [string, string][] = [
  ["CHF", "chf|fr\\.|francs?|franken|franchi"],
  ["EUR", "eur|€|euros?"],
  ["USD", "usd|\\$|dollars?|dollar[oi]"],
  ["GBP", "gbp|£|pounds?|pfund|sterline"],
];
const DURATIONS: [RegExp, number, "s" | "mo"][] = [
  [unit("ms|milliseconds?|millisecond[oi]|millisekunden?"), 0.001, "s"],
  [unit("s|secs?|seconds?|second[oi]|sekunden?|sek\\.?"), 1, "s"],
  [unit("mins?|minutes?|minut[oi]|minuten?|minütig\\p{L}*"), 60, "s"],
  [unit("h|hrs?|hours?|or[ae]|stunden?|std\\.?|stündig\\p{L}*"), 3600, "s"],
  [unit("days?|giorn[oi]|tage?n?|tägig\\p{L}*"), 86_400, "s"],
  [unit("weeks?|settiman[ae]|wochen?|wöchig\\p{L}*"), 604_800, "s"],
  [unit("months?|mes[ei]|monate?n?|monatig\\p{L}*"), 1, "mo"],
  [unit("yrs?|years?|ann[oi]|jahre?n?|jährig\\p{L}*"), 12, "mo"],
];
/** In "from 45 to 8 minutes" the first number takes the unit of the second. */
const JOINED = /^\s*(?:to|and|or|a|ad|e|o|auf|bis|und|oder|-|–|—|→|\/)\s*$/iu;

type Unit = { kind: QuantityKind; convert: (value: number) => string };
const COUNT: Unit = { kind: "count", convert: canonical };

function takeNumbers(text: string, found: Quantity[]): void {
  const numbers = [...text.matchAll(/\p{Nd}+(?:['.,]\p{Nd}+)*|\p{N}/gu)];
  const results: Quantity[] = [];
  let next: { unit: Unit | undefined; start: number } | undefined;
  // From right to left, so that a number can take over the unit of the one after it.
  for (const match of numbers.reverse()) {
    const raw = match[0];
    const end = match.index + raw.length;
    let after = text.slice(end);
    let factor = 1;
    for (const [pattern, multiplier] of MULTIPLIERS) {
      const hit = pattern.exec(after);
      if (!hit) continue;
      factor = multiplier;
      after = after.slice(hit[0].length);
      break;
    }
    let own = findUnit(text.slice(0, match.index), after);
    if (!own && next && JOINED.test(text.slice(end, next.start))) own = next.unit;
    const { kind, convert } = own ?? COUNT;
    const candidates = parseNumber(raw).map((value) =>
      typeof value === "string" ? value : convert(value * factor),
    );
    const isYear = !own && factor === 1 && /^(?:19|20)\d\d$/.test(raw);
    results.unshift({ raw, kind: isYear ? "date" : kind, values: candidates });
    next = { unit: own, start: match.index };
  }
  found.push(...results);
}

function findUnit(before: string, after: string): Unit | undefined {
  if (PERCENT.test(after)) return { kind: "percent", convert: canonical };
  for (const [code, words] of CURRENCIES) {
    const follows = new RegExp(`^\\s*(?:di\\s+)?(?:${words})(?!\\p{L})`, "iu").test(after);
    const precedes = new RegExp(`(?<!\\p{L})(?:${words})\\s*$`, "iu").test(before);
    if (follows || precedes) {
      return { kind: "money", convert: (value) => `${code} ${canonical(value)}` };
    }
  }
  for (const [pattern, size, base] of DURATIONS) {
    if (pattern.test(after)) {
      return { kind: "duration", convert: (value) => `${canonical(value * size)} ${base}` };
    }
  }
  if (FACTOR.test(after)) return { kind: "factor", convert: canonical };
  return undefined;
}

/** Every reading of the notation. A string is something else with dots, such as a version. */
function parseNumber(raw: string): (number | string)[] {
  // Digits of other scripts are never in a source, so they stay as they are and never match.
  if (!/^[\d'.,]+$/.test(raw)) return [raw];
  const plain = raw.replaceAll("'", "");
  const separators = plain.match(/[.,]/g) ?? [];
  const last = separators.at(-1);
  if (!last) return [Number(plain)];
  const groups = plain.split(/[.,]/);
  const grouped = groups.slice(1).every((group) => group.length === 3);
  const whole = Number(groups.join(""));

  if (separators.length === 1) {
    const decimal = Number(groups.join("."));
    const ambiguous = grouped && /^[1-9]\d{0,2}$/.test(groups[0] ?? "");
    return ambiguous ? [whole, decimal] : [decimal];
  }
  if (separators.every((separator) => separator === last)) return [grouped ? whole : raw];
  if (separators.filter((separator) => separator === last).length > 1) return [raw];
  return [Number(`${groups.slice(0, -1).join("")}.${groups.at(-1)}`)];
}

/** Rounds away floating-point noise from unit conversion. */
function canonical(value: number): string {
  return String(Number(value.toPrecision(12)));
}
