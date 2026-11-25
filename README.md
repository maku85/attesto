# attesto

A career knowledge base exposed via MCP, with claim-level provenance. _No source, no claim._

Work in progress. The pipeline is complete; it has not been evaluated yet.

```sh
pnpm install
pnpm attesto validate --kb examples/kb
pnpm attesto search kubernetes --type achievement --kb examples/kb

# These need ANTHROPIC_API_KEY
pnpm attesto generate --job posting.txt --type cv --lang en --market ch-en --kb examples/kb
pnpm attesto verify out/cv-en-….document.json --kb examples/kb
pnpm judge:probe

pnpm attesto runs list
pnpm attesto mcp --kb examples/kb    # MCP server over stdio
pnpm attesto init                    # your own knowledge base in ~/.attesto/kb
```

Requires Node.js 22.18 or later. The sample person in `examples/kb` is fictional.
