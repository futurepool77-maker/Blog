# QSIF Audit Engine

Audits a single web page / article through independent "lens" prompts, reconciles
their findings into one dependency-ordered build list, and renders that list as a
standalone, self-contained HTML report.

The headline use case: paste an existing article, the pipeline does the rest and
outputs an HTML report.

## Topology — fan-out then merge

```
                ┌────────────────────────────────────────────┐
   ARTICLE ────▶│  N lenses, each gets the SAME article,      │
                │  run independently / in parallel.           │
                │  None sees another lens's output.           │
                └───────────────┬────────────────────────────┘
                                │  N JSON findings objects
                                ▼
                       ┌──────────────────┐
                       │  RECONCILIATION  │  (sees all N at once)
                       └────────┬─────────┘
                                │  1 reconciled JSON build-order
                                ▼
                       ┌──────────────────┐
                       │   HTML RENDERER  │  (deterministic, template fill)
                       └────────┬─────────┘
                                ▼
                       live HTML report file
```

No lens receives prior lens output. The shared block is concatenated into every
lens call as a constant. Reconciliation is the only step that receives multiple
lens outputs. The renderer is deterministic — the model emits JSON, the template
owns presentation.

## The lenses

| Lens          | Tag    | Question it answers                                            |
|---------------|--------|----------------------------------------------------------------|
| Architecture  | ARCH   | Does the page's structure match the structure of the domain?   |
| Accuracy      | ACC    | Is what the page already states true and current?              |
| Knowledge     | KNOW   | Does the page hold the complete knowledge an expert expects?   |
| Trust         | TRUST  | Does the page earn the reader's and the engine's trust?        |
| Intent        | INTENT | Does a searcher get what they came for and leave satisfied?    |
| Conversion    | CONV   | Does the page move a qualified buyer to the action it wants?   |
| Entity        | ENTITY | Can a search engine extract the right entities & relationships?|
| Linguistic    | LING   | Does the language read from inside the field?                  |
| Competitor    | COMP   | What does a specific competing page do that this one does not? (side-tool) |

`/prompts` holds each prompt as plain text so they can be edited without touching
code. The per-lens assembly order is **lens body → shared block → article**.

## Modes

- **routine** (default): `architecture, accuracy, trust, conversion` — the 4 that
  do the core job. Fast, low-noise.
- **flagship**: all 8 lenses. Opt-in per run with `--mode flagship`.

Routine is the default on purpose — running all eight on every page is slow and
noisy enough that people stop trusting it.

## Layout

```
/prompts        one .md per lens + shared_block, reconcile, competitor, blueprint
/engine         orchestrator, api client, JSON validation, HTML renderer
/templates      report.html — the self-contained report template
/output         generated reports/briefs (git-ignored)
config.js       models, lens sets, web-search + concurrency toggles
```

## Setup

Requires Node.js 18+ (uses global `fetch`). Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Web search is enabled on the verification lenses (accuracy, knowledge). Without it
those lenses cannot reach a "verified" evidence tag. See `config.js`.

## Usage

### Audit an existing article (Mode B — the main feature)

```bash
# From a file (raw HTML preferred — the Entity lens audits schema/markup):
node bin/audit.js article.html

# From stdin — "paste an article and it does the rest":
pbpaste | node bin/audit.js -

# All 8 lenses, with a competitor folded into reconciliation:
node bin/audit.js article.html --mode flagship --competitor https://rival.example/post
```

Prints the path to the generated `output/<slug>-<timestamp>.html` report.

Options: `--mode routine|flagship`, `--competitor <url_or_path>`, `--page <id>`,
`--out <path>`.

### Blueprint a new article (Mode A — planning, before writing)

```bash
node bin/blueprint.js "ICD-10 coding for sepsis" --type hub \
  --parent https://site.example/clinical-coding \
  --children "sepsis-vs-bacteremia,present-on-admission" --html
```

Single call. Writes a writing brief to `output/<slug>-brief.md` (or `.html` with
`--html`). The human writes the draft into the brief, then runs `audit` on the draft.

If installed via `npm link` / `npm install -g`, the `audit` and `blueprint`
commands are available directly.

## Output schemas

Every lens returns the strict findings JSON (see `prompts/shared_block.md`).
Reconciliation returns a build-order JSON (see `prompts/reconcile.md`). Evidence
tags — `verified` / `inferred` / `opinion` — survive the merge and render as
badges in the report, so opinion-vs-verified stays visible at the point of
decision. Keep them visible.

## Resilience

Every lens output is JSON-validated with one retry. A lens that still fails is
recorded as FAILED, excluded from the reconciliation bundle, and surfaced as a
visible warning in the report — one malformed lens never blocks the run or feeds
garbage into reconciliation.
