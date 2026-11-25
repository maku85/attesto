import type { Lang } from "../../kb/schema.ts";

/** "2021-03" as a month and year, "2021" as it is. */
export function formatMonth(date: string, lang: Lang): string {
  return date.length === 4 ? date : format(`${date}-01`, lang, { year: "numeric", month: "long" });
}

export function formatDay(date: string, lang: Lang): string {
  return format(date, lang, { year: "numeric", month: "long", day: "numeric" });
}

function format(date: string, lang: Lang, options: Intl.DateTimeFormatOptions): string {
  // UTC on both sides, so that the day does not depend on the time zone.
  return new Intl.DateTimeFormat(`${lang}-CH`, { ...options, timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}
