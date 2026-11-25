# attesto

A career knowledge base exposed via MCP, with claim-level provenance. _No source, no claim._

Work in progress. Available so far: the knowledge base, search, job posting analysis, and the drafting
and verification pipeline with stored runs. Rendering and the `generate` command come next.

```sh
pnpm install
pnpm attesto validate --kb examples/kb
pnpm attesto search kubernetes --type achievement --kb examples/kb
pnpm attesto get skl-kubernetes --kb examples/kb
pnpm attesto analyze posting.txt     # needs ANTHROPIC_API_KEY
pnpm attesto verify document.json    # needs ANTHROPIC_API_KEY
pnpm attesto runs list
pnpm attesto mcp --kb examples/kb    # MCP server over stdio
```

Requires Node.js 22.18 or later. The sample person in `examples/kb` is fictional.
