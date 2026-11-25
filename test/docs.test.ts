import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ROOT } from "./fixtures.ts";

const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

it("README links to files that exist, and to every ADR", () => {
  const targets = [...readme.matchAll(/\]\((?!https?:)([^)#]+)\)/g)].map(([, path]) => path!);
  for (const path of targets)
    expect({ path, exists: existsSync(join(ROOT, path)) }).toEqual({ path, exists: true });
  for (const adr of readdirSync(join(ROOT, "docs/adr")))
    expect(targets).toContain(`docs/adr/${adr}`);
});

it("README names every MCP tool and every environment variable", () => {
  const tools = [...read("src/mcp/server.ts").matchAll(/registerTool\(\s*"([a-z_]+)"/g)];
  expect(tools.length).toBe(8);
  for (const [, name] of tools) expect(readme).toContain(`\`${name}\``);
  const sources = ["src/cli/main.ts", "src/kb/load.ts", "src/store/db.ts", "src/llm/provider.ts"];
  const variables = sources.flatMap((path) => read(path).match(/ATTESTO_[A-Z_]+/g) ?? []);
  for (const name of variables) expect(readme).toContain(`\`${name}\``);
});

it("the MCP client example is valid JSON and runs the mcp command", () => {
  const { mcpServers } = JSON.parse(read("examples/mcp/claude-desktop.json")) as {
    mcpServers: { attesto: { args: string[] } };
  };
  expect(mcpServers.attesto.args).toContain("mcp");
});
