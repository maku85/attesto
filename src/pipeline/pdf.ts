import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const TIMEOUT_MS = 60_000;

const APPLICATIONS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const COMMANDS = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

/** A browser that can print. ATTESTO_BROWSER wins over the usual places. */
export function findBrowser(): string | undefined {
  const named = process.env.ATTESTO_BROWSER;
  if (named) return existsSync(named) ? named : undefined;
  const onPath = (process.env.PATH ?? "")
    .split(delimiter)
    .flatMap((dir) => COMMANDS.map((command) => join(dir, command)));
  return [...APPLICATIONS, ...onPath].find((path) => existsSync(path));
}

/** Call before anything that costs money. */
export function requireBrowser(): string {
  const browser = findBrowser();
  if (!browser) {
    throw new Error(
      "A PDF needs Chrome, Chromium or Edge, and none was found. Set ATTESTO_BROWSER to its path, " +
        "or leave out --pdf and print the HTML from any browser.",
    );
  }
  return browser;
}

/** Prints with a profile of its own, which is deleted afterwards. */
export async function htmlToPdf(browser: string, html: string): Promise<Buffer> {
  // Readable by the owner only, like everything else that holds personal data.
  const dir = mkdtempSync(join(tmpdir(), "attesto-pdf-"));
  try {
    const page = join(dir, "page.html");
    const pdf = join(dir, "page.pdf");
    writeFileSync(page, html);
    await run(
      browser,
      [
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--disable-extensions",
        "--disable-sync",
        "--disable-component-update",
        "--disable-background-networking",
        "--no-pdf-header-footer",
        `--user-data-dir=${join(dir, "profile")}`,
        `--print-to-pdf=${pdf}`,
        pathToFileURL(page).href,
      ],
      { timeout: TIMEOUT_MS },
    );
    if (!existsSync(pdf)) throw new Error(`${browser} did not write a PDF`);
    return readFileSync(pdf);
  } finally {
    // The browser may still be writing to its profile for a moment.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
