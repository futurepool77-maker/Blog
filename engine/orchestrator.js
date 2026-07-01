// Orchestrator: fan-out -> validate -> reconcile -> render.
//
// Topology is fan-out then merge. Each lens gets the SAME article plus the
// shared block; no lens ever sees another lens's output. Reconciliation is the
// only step that receives multiple lens outputs.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { config, LENS_META } from "../config.js";
import { callApi } from "./api.js";
import { validateLensJson, validateReconcileJson } from "./validate.js";
import { renderHtml } from "./render_html.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROMPTS_DIR = join(ROOT, "prompts");
const OUTPUT_DIR = join(ROOT, "output");

const ARTICLE_DELIM = "\n\n=== ARTICLE ===\n";
const COMPETITOR_DELIM = "\n\n=== COMPETITOR CONTENT ===\n";

// --- prompt loading ---------------------------------------------------------

const _cache = new Map();
async function loadPrompt(file) {
  if (_cache.has(file)) return _cache.get(file);
  const text = await readFile(join(PROMPTS_DIR, file), "utf8");
  _cache.set(file, text);
  return text;
}

// Assembly order per lens call: identity, lens body, shared block, article.
// The identity line pins the exact "lens" value and id prefix so the model does
// not invent its own label (the shared block only shows <LENS_TAG> as a slot).
function assembleLensPrompt(meta, lensBody, sharedBlock, article) {
  const identity =
    `You are the ${meta.name} lens (tag: ${meta.tag}). In the JSON you return, ` +
    `set "lens" to exactly "${meta.name}" and prefix every finding id with ` +
    `"${meta.tag}-" (for example ${meta.tag}-01). Use no other lens name or id prefix.\n\n`;
  return `${identity}${lensBody}\n\n${sharedBlock}${ARTICLE_DELIM}${article}`;
}

function modelFor(lensKey) {
  return config.VERIFY_LENSES.includes(lensKey) ? config.MODEL_VERIFY : config.MODEL_STANDARD;
}

function webSearchFor(lensKey) {
  return config.ENABLE_WEB_SEARCH && config.WEB_SEARCH_LENSES.includes(lensKey);
}

// --- bounded-concurrency map ------------------------------------------------

async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(runners);
  return results;
}

// --- single lens ------------------------------------------------------------

// Runs one lens, validates with one retry. Returns { ok, obj } or { ok:false }.
async function runLens(lensKey, article, sharedBlock, log) {
  const meta = LENS_META[lensKey];
  const lensBody = await loadPrompt(meta.file);
  const prompt = assembleLensPrompt(meta, lensBody, sharedBlock, article);
  const model = modelFor(lensKey);
  const webSearch = webSearchFor(lensKey);

  log(`  → ${meta.name} (${model}${webSearch ? ", web_search" : ""})`);

  const callWith = (suffix = "") =>
    callApi({ model, prompt: prompt + suffix, webSearch, maxTokens: config.MAX_TOKENS });

  let raw;
  try {
    raw = await callWith("");
  } catch (e) {
    log(`  ✗ ${meta.name} API error: ${e.message}`);
    return { ok: false, lens: meta.name };
  }

  const result = await validateLensJson({ raw, meta, caller: callWith });
  if (!result.ok) {
    log(`  ✗ ${meta.name} invalid output (${result.error}) — skipped`);
    return { ok: false, lens: meta.name };
  }
  log(`  ✓ ${meta.name} (${result.obj.findings.length} findings)`);
  return { ok: true, obj: result.obj };
}

// --- competitor side-tool ---------------------------------------------------

// Runs only when competitor content is supplied. Same JSON findings shape.
async function runCompetitor(article, competitorContent, sharedBlock, log) {
  if (!competitorContent) return { ok: false, skipped: true };
  const meta = LENS_META.competitor;
  const body = await loadPrompt(meta.file);
  const identity =
    `You are the ${meta.name} lens (tag: ${meta.tag}). In the JSON you return, ` +
    `set "lens" to exactly "${meta.name}" and prefix every finding id with "${meta.tag}-".\n\n`;
  const prompt =
    `${identity}${body}\n\n${sharedBlock}${ARTICLE_DELIM}${article}${COMPETITOR_DELIM}${competitorContent}`;

  log(`  → COMPETITOR (${config.MODEL_STANDARD})`);
  const callWith = (suffix = "") =>
    callApi({
      model: config.MODEL_STANDARD,
      prompt: prompt + suffix,
      webSearch: config.ENABLE_WEB_SEARCH,
      maxTokens: config.MAX_TOKENS,
    });

  let raw;
  try {
    raw = await callWith("");
  } catch (e) {
    log(`  ✗ COMPETITOR API error: ${e.message}`);
    return { ok: false, lens: meta.name };
  }
  const result = await validateLensJson({ raw, meta, caller: callWith });
  if (!result.ok) {
    log(`  ✗ COMPETITOR invalid output (${result.error}) — skipped`);
    return { ok: false, lens: meta.name };
  }
  log(`  ✓ COMPETITOR (${result.obj.findings.length} findings)`);
  return { ok: true, obj: result.obj };
}

// --- reconciliation ---------------------------------------------------------

async function reconcile(page, lensOutputs, mode, log) {
  const body = await loadPrompt("reconcile.md");
  const input = { page, lens_outputs: lensOutputs };
  const prompt = `${body}\n\n${JSON.stringify(input, null, 2)}`;

  log(`  → RECONCILE (${config.MODEL_STANDARD}, ${lensOutputs.length} lens outputs)`);
  const callWith = (suffix = "") =>
    callApi({
      model: config.MODEL_STANDARD,
      prompt: prompt + suffix,
      webSearch: false,
      maxTokens: config.MAX_TOKENS_RECONCILE,
    });

  const raw = await callWith("");
  const result = await validateReconcileJson({ raw, caller: callWith });
  if (!result.ok) {
    throw new Error(`Reconciliation returned invalid JSON: ${result.error}`);
  }

  // Fill engine-owned fields the model may omit or get wrong.
  const obj = result.obj;
  obj.page = obj.page || page;
  obj.mode = mode;
  obj.generated_iso = obj.generated_iso || new Date().toISOString();
  return obj;
}

// --- helpers ----------------------------------------------------------------

export function slugify(s) {
  return (
    String(s || "report")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "report"
  );
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

// Derive a page identifier from raw article content (title/h1) or fall back.
function derivePageId(article, fallback) {
  const titleMatch = article.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim();
  const h1Match = article.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) return h1Match[1].trim();
  const mdHeading = article.match(/^#\s+(.+)$/m);
  if (mdHeading) return mdHeading[1].trim();
  return fallback || "Untitled page";
}

// --- Mode B: audit an existing article --------------------------------------

// opts: { article, page?, mode?, competitorContent?, out?, log? }
// Returns { path, reconciled, failedLenses }.
export async function audit(opts) {
  const log = opts.log || (() => {});
  const mode = opts.mode || config.DEFAULT_MODE;
  const lensKeys = config.MODES[mode];
  if (!lensKeys) throw new Error(`Unknown mode '${mode}'. Use routine or flagship.`);

  const article = opts.article;
  if (!article || !article.trim()) throw new Error("Article content is empty.");
  const page = opts.page || derivePageId(article, opts.pageFallback);

  const sharedBlock = await loadPrompt("shared_block.md");

  log(`Auditing "${page}" — mode: ${mode} — lenses: ${lensKeys.join(", ")}`);

  // 1+2. Fan-out: every lens gets the SAME article, run with bounded concurrency.
  const lensResults = await mapWithLimit(lensKeys, config.MAX_PARALLEL, (lensKey) =>
    runLens(lensKey, article, sharedBlock, log)
  );

  // Competitor (NOT in the batch) — only with supplied content.
  if (opts.competitorContent) {
    const comp = await runCompetitor(article, opts.competitorContent, sharedBlock, log);
    lensResults.push(comp);
  } else if (opts.competitorRequested) {
    log("  ! Competitor requested but no content supplied — skipped (needs a real URL/content).");
  }

  const lensOutputs = lensResults.filter((r) => r && r.ok).map((r) => r.obj);
  const failedLenses = lensResults.filter((r) => r && !r.ok && !r.skipped).map((r) => r.lens);

  if (!lensOutputs.length) {
    throw new Error("Every lens failed to return valid output; nothing to reconcile.");
  }

  const base = opts.out
    ? opts.out.replace(/\.html?$/i, "")
    : join(OUTPUT_DIR, `${slugify(page)}-${timestamp()}`);

  // Cache the (expensive) lens outputs before reconciling, so a reconcile
  // failure never forces re-running the lenses. Resume with --reconcile-only.
  const cachePath = `${base}.lenses.json`;
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(
    cachePath,
    JSON.stringify({ page, mode, failedLenses, lens_outputs: lensOutputs }, null, 2),
    "utf8"
  );
  log(`  · lens outputs cached → ${cachePath}`);

  // 3-5. Reconcile, render, write.
  return finalizeAudit({
    page,
    mode,
    lensOutputs,
    failedLenses,
    out: opts.out || `${base}.html`,
    log,
  });
}

// Reconcile + render + write, given already-collected lens outputs. Split out
// so it can be re-run from the cache without repeating the lens calls.
// opts: { page, mode, lensOutputs, failedLenses?, out?, log? }
export async function finalizeAudit(opts) {
  const log = opts.log || (() => {});
  const { page, mode, lensOutputs } = opts;
  const failedLenses = opts.failedLenses || [];

  // 3. Reconcile — the only step that sees all lens outputs at once.
  const reconciled = await reconcile(page, lensOutputs, mode, log);

  // 4. Render deterministically.
  const html = await renderHtml(reconciled, { lensOutputs, failedLenses });

  // 5. Write to /output/<slug>-<timestamp>.html
  const outPath = opts.out || join(OUTPUT_DIR, `${slugify(page)}-${timestamp()}.html`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf8");

  return { path: outPath, reconciled, failedLenses };
}

// Load a cached lens-outputs sidecar and finalize from it (resume path).
export async function reconcileOnly(cachePath, out, log) {
  const cached = JSON.parse(await readFile(cachePath, "utf8"));
  return finalizeAudit({
    page: cached.page,
    mode: cached.mode,
    lensOutputs: cached.lens_outputs,
    failedLenses: cached.failedLenses || [],
    out,
    log,
  });
}

// --- Mode A: blueprint a new article ----------------------------------------

// opts: { topic, type, parent?, children?, html?, out?, log? }
export async function blueprint(opts) {
  const log = opts.log || (() => {});
  const body = await loadPrompt("blueprint.md");

  const mapContext =
    `\n\nTOPIC: ${opts.topic}\n` +
    `PAGE TYPE: ${opts.type}\n` +
    `PARENT: ${opts.parent || "(none)"}\n` +
    `INTENDED CHILDREN: ${opts.children && opts.children.length ? opts.children.join(", ") : "(none)"}`;

  // For the HTML variant, ask for the JSON shape noted at the end of blueprint.md.
  const jsonNudge = opts.html
    ? "\n\nReturn ONLY the JSON variant object described at the end of these instructions."
    : "";
  const prompt = body + mapContext + jsonNudge;

  log(`Blueprinting "${opts.topic}" (${opts.type}) — ${config.MODEL_VERIFY}, web_search`);
  const text = await callApi({
    model: config.MODEL_VERIFY,
    prompt,
    webSearch: true,
    maxTokens: config.MAX_TOKENS,
  });

  const slug = slugify(opts.topic);
  let outPath;
  let content;

  if (opts.html) {
    // Render the JSON brief into the report template's brief variant (reuse page header).
    const { stripToJson } = await import("./validate.js");
    let parsed;
    try {
      parsed = JSON.parse(stripToJson(text));
    } catch {
      parsed = null;
    }
    content = parsed ? renderBriefHtml(opts.topic, parsed) : text;
    outPath = opts.out || join(OUTPUT_DIR, `${slug}-brief.html`);
  } else {
    content = text;
    outPath = opts.out || join(OUTPUT_DIR, `${slug}-brief.md`);
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, content, "utf8");
  return { path: outPath };
}

// Minimal self-contained HTML for a blueprint brief (JSON variant).
function renderBriefHtml(topic, b) {
  const esc = (s) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const list = (arr) => (arr || []).map((x) => `<li>${esc(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("");
  const concepts = (b.concepts || [])
    .map((c) => `<li><b>${esc(c.name)}</b> — target L${esc(c.target_level)} · owner: ${esc(c.owner)}</li>`)
    .join("");
  const currency = (b.currency_flags || [])
    .map((c) => `<li><b>${esc(c.fact)}</b>: ${esc(c.current_value)} <small>(${esc(c.source)})</small></li>`)
    .join("");
  const ent = b.entities || {};
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Brief — ${esc(topic)}</title>
<style>body{margin:0;background:#0c1118;color:#e9edf2;font:16px/1.6 -apple-system,system-ui,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:40px 24px 80px}h1{font-size:24px}
h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#9aa6b6;border-bottom:1px solid rgba(255,255,255,.09);padding-bottom:8px;margin:34px 0 14px}
li{margin:6px 0}small{color:#9aa6b6}</style></head><body><div class="wrap">
<h1>Writing brief — ${esc(topic)}</h1>
<h2>Structure</h2><ol>${list(b.structure)}</ol>
<h2>Concept checklist</h2><ul>${concepts}</ul>
<h2>Entities &amp; schema</h2>
<p><b>Names:</b></p><ul>${list(ent.names)}</ul>
<p><b>Authorities:</b></p><ul>${list(ent.authorities)}</ul>
<p><b>Relationships:</b></p><ul>${list(ent.relationships)}</ul>
<p><b>Schema:</b></p><ul>${list(ent.schema)}</ul>
<h2>Currency flags</h2><ul>${currency}</ul>
<h2>Cluster fit</h2><p>${esc(b.cluster_fit)}</p>
</div></body></html>`;
}
