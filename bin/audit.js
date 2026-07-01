#!/usr/bin/env node
// audit <article_path_or_-> [--mode routine|flagship] [--competitor <url_or_path>] [--out <path>] [--page <id>]
//
// Reads the article (or stdin if -), runs Mode B, writes the HTML report,
// prints the path. With --competitor, folds the competitor side-tool into
// reconciliation.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { audit, reconcileOnly } from "../engine/orchestrator.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") args.mode = argv[++i];
    else if (a === "--competitor") args.competitor = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--page") args.page = argv[++i];
    else if (a === "--reconcile-only") args.reconcileOnly = argv[++i];
    else if (a === "-h" || a === "--help") args.help = true;
    else args._.push(a);
  }
  return args;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

// A competitor arg may be a URL (fetch it) or a local file path (read it).
async function loadMaybeUrlOrFile(ref) {
  if (/^https?:\/\//i.test(ref)) {
    const res = await fetch(ref);
    if (!res.ok) throw new Error(`Failed to fetch competitor URL: ${res.status}`);
    return res.text();
  }
  return readFile(ref, "utf8");
}

const HELP = `Usage:
  audit <article_path_or_-> [options]

Options:
  --mode <routine|flagship>   lens set (default: routine = 4 lenses)
  --competitor <url_or_path>  run the competitor side-tool and fold it into reconcile
  --page <identifier>         page label for the report (default: derived from content)
  --out <path>                output HTML path (default: output/<slug>-<timestamp>.html)
  --reconcile-only <file>     skip the lenses; re-reconcile + render from a cached
                              .lenses.json (resume a run without re-spending on lenses)
  -h, --help                  show this help

Reads from stdin when the path is "-".`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Resume path: reconcile + render from a cached lens-outputs sidecar.
  if (args.reconcileOnly) {
    const result = await reconcileOnly(args.reconcileOnly, args.out, (m) => console.error(m));
    if (result.failedLenses.length) {
      console.error(`\nNote: ${result.failedLenses.length} lens(es) were skipped in the cached run.`);
    }
    console.log(result.path);
    return;
  }

  if (args.help || !args._.length) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }

  const src = args._[0];
  let article;
  let pageFallback;
  if (src === "-") {
    article = await readStdin();
    pageFallback = "Pasted article";
  } else {
    article = await readFile(src, "utf8");
    pageFallback = basename(src);
  }

  let competitorContent = null;
  if (args.competitor) {
    competitorContent = await loadMaybeUrlOrFile(args.competitor);
  }

  const result = await audit({
    article,
    page: args.page,
    pageFallback,
    mode: args.mode,
    competitorContent,
    competitorRequested: Boolean(args.competitor),
    out: args.out,
    log: (m) => console.error(m),
  });

  if (result.failedLenses.length) {
    console.error(`\nWarning: ${result.failedLenses.length} lens(es) skipped: ${result.failedLenses.join(", ")}`);
  }
  // The report path is the deliverable — print it on stdout.
  console.log(result.path);
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
