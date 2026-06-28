// Deterministic renderer: reconciled JSON -> HTML via token replacement into
// templates/report.html. The model never emits HTML; the template owns
// presentation so every report looks the same and nothing needs validating.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE = join(__dirname, "..", "templates", "report.html");

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SEVERITIES = new Set(["Foundational", "High", "Medium", "Low"]);
const EVIDENCES = new Set(["verified", "inferred", "opinion"]);

// Look up a build_order task by its number.
function taskByN(buildOrder, n) {
  return buildOrder.find((t) => t.n === n);
}

function renderDoFirst(reconciled) {
  const items = (reconciled.do_first || [])
    .map((n) => {
      const t = taskByN(reconciled.build_order, n);
      return t ? `<li>${n}. ${esc(t.task)}</li>` : `<li>${n}.</li>`;
    })
    .join("\n    ");
  return items || "<li>None flagged.</li>";
}

function renderQuickWins(reconciled) {
  const items = (reconciled.quick_wins || [])
    .map((n) => {
      const t = taskByN(reconciled.build_order, n);
      return t ? `<li>${n}. ${esc(t.task)}</li>` : `<li>${n}.</li>`;
    })
    .join("\n    ");
  return items || "<li>None.</li>";
}

function renderBuildRows(reconciled) {
  return (reconciled.build_order || [])
    .map((t) => {
      const sev = SEVERITIES.has(t.severity) ? t.severity : "Low";
      const ev = EVIDENCES.has(t.evidence) ? t.evidence : "inferred";
      const lenses = Array.isArray(t.lenses) ? t.lenses.join(", ") : "";
      const depends =
        Array.isArray(t.depends_on) && t.depends_on.length ? t.depends_on.join(", ") : "—";
      const conflict =
        t.conflict_note && t.conflict_note !== "null"
          ? `<div class="conflict">${esc(t.conflict_note)}</div>`
          : "";
      return `<tr>
        <td class="n">${esc(t.n)}</td>
        <td>${esc(t.task)}${conflict}</td>
        <td class="lenses">${esc(lenses)}</td>
        <td><span class="sev ${sev}">${sev}</span></td>
        <td class="n">${esc(depends)}</td>
        <td>${esc(t.effort || "—")}</td>
        <td><span class="ev ${ev}">${ev}</span></td>
      </tr>`;
    })
    .join("\n      ");
}

function renderDefer(reconciled) {
  const items = (reconciled.defer_drop || [])
    .map((d) => `${esc(d.task)} — ${esc(d.reason)}`)
    .join("<br>\n  ");
  return items || "Nothing deferred or dropped.";
}

function renderRootCauses(reconciled) {
  const items = (reconciled.root_causes || [])
    .filter((r) => r && r !== "none")
    .map((r) => esc(r))
    .join("<br>\n  ");
  return items || "No single root cause named.";
}

function renderWarnings(failedLenses) {
  if (!failedLenses || !failedLenses.length) return "";
  return failedLenses
    .map(
      (l) =>
        `<div class="warn">Lens ${esc(l)} did not return valid output and was skipped.</div>`
    )
    .join("\n  ");
}

// Appendix: one <details> per lens with its raw findings. Optional input.
function renderAppendix(lensOutputs) {
  if (!lensOutputs || !lensOutputs.length) return "";
  return lensOutputs
    .map((lo) => {
      const rows = (lo.findings || [])
        .map((f) => {
          const sev = SEVERITIES.has(f.severity) ? f.severity : "Low";
          const ev = f.evidence && EVIDENCES.has(f.evidence.type) ? f.evidence.type : "inferred";
          return `<tr>
            <td class="n">${esc(f.id)}</td>
            <td>${esc(f.finding)}<div class="conflict">Fix: ${esc(f.fix)}</div></td>
            <td><span class="sev ${sev}">${sev}</span></td>
            <td><span class="ev ${ev}">${ev}</span></td>
          </tr>`;
        })
        .join("\n        ");
      return `<details>
    <summary>${esc(lo.lens)} — ${(lo.findings || []).length} findings</summary>
    <table>
      <thead><tr><th>ID</th><th>Finding</th><th>Severity</th><th>Evidence</th></tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </details>`;
    })
    .join("\n  ");
}

// Render the reconciled JSON into HTML.
// opts: { template?, lensOutputs?, failedLenses? }
export async function renderHtml(reconciled, opts = {}) {
  const templatePath = opts.template || DEFAULT_TEMPLATE;
  const template = await readFile(templatePath, "utf8");

  const summary = reconciled.summary || {};
  const replacements = {
    "{{PAGE}}": esc(reconciled.page || "Untitled"),
    "{{GENERATED}}": esc(reconciled.generated_iso || new Date().toISOString()),
    "{{MODE}}": esc(reconciled.mode || ""),
    "{{WARNINGS_BLOCK}}": renderWarnings(opts.failedLenses),
    "{{RAW}}": esc(summary.raw_findings ?? ""),
    "{{MERGED}}": esc(summary.after_merge ?? (reconciled.build_order || []).length),
    "{{DOFIRST}}": esc(summary.do_first ?? (reconciled.do_first || []).length),
    "{{QUICK}}": esc(summary.quick_wins ?? (reconciled.quick_wins || []).length),
    "{{DO_FIRST_ITEMS}}": renderDoFirst(reconciled),
    "{{BUILD_ROWS}}": renderBuildRows(reconciled),
    "{{QUICK_ITEMS}}": renderQuickWins(reconciled),
    "{{DEFER_ITEMS}}": renderDefer(reconciled),
    "{{ROOT_CAUSES}}": renderRootCauses(reconciled),
    "{{LENS_APPENDIX}}": renderAppendix(opts.lensOutputs),
  };

  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }
  // Strip the template's HTML comments (renderer hints).
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  return html;
}
