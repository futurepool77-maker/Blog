#!/usr/bin/env node
// blueprint "<topic>" --type pillar|hub|child [--parent <url>] [--children <comma,list>] [--html]
//
// Runs Mode A (single call), writes the writing brief (Markdown by default,
// HTML with --html), prints the path.

import { blueprint } from "../engine/orchestrator.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--type") args.type = argv[++i];
    else if (a === "--parent") args.parent = argv[++i];
    else if (a === "--children") args.children = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--html") args.html = true;
    else if (a === "-h" || a === "--help") args.help = true;
    else args._.push(a);
  }
  return args;
}

const HELP = `Usage:
  blueprint "<topic>" --type <pillar|hub|child> [options]

Options:
  --type <pillar|hub|child>   page's place in the topical map (required)
  --parent <url>              parent page URL/identifier
  --children <comma,list>     intended child pages
  --html                      render the brief to HTML (default: Markdown)
  --out <path>                output path (default: output/<slug>-brief.{md,html})
  -h, --help                  show this help`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args._.length || !args.type) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }

  const result = await blueprint({
    topic: args._.join(" "),
    type: args.type,
    parent: args.parent,
    children: args.children ? args.children.split(",").map((s) => s.trim()).filter(Boolean) : [],
    html: args.html,
    out: args.out,
    log: (m) => console.error(m),
  });

  console.log(result.path);
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
