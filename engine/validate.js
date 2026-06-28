// JSON validation + one-retry logic for lens and reconciliation output.
// A malformed lens never blocks the run: it is recorded as FAILED, excluded
// from the reconciliation bundle, and surfaced as a warning in the report.

const RETRY_INSTRUCTION =
  "\n\nYour previous response was not valid JSON. Return ONLY the JSON object, no other text.";

// Strip accidental code fences / leading-trailing prose by isolating the
// outermost { ... } span.
export function stripToJson(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  // Drop a leading ```json / ``` fence if present.
  s = s.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  return s.trim();
}

function tryParse(raw) {
  try {
    return { ok: true, obj: JSON.parse(stripToJson(raw)) };
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${e.message}` };
  }
}

// Schema check for a lens output. Returns { ok, error }.
function checkLensSchema(obj, meta) {
  if (typeof obj !== "object" || obj === null) return { ok: false, error: "not an object" };
  if (typeof obj.lens !== "string") return { ok: false, error: "missing 'lens'" };

  const lensVal = obj.lens.trim().toUpperCase();
  if (lensVal !== meta.name && lensVal !== meta.tag) {
    return { ok: false, error: `lens '${obj.lens}' != expected ${meta.name}/${meta.tag}` };
  }
  if (!("calibration" in obj)) return { ok: false, error: "missing 'calibration'" };
  if (!Array.isArray(obj.findings)) return { ok: false, error: "'findings' is not an array" };
  if (!("root_cause" in obj)) return { ok: false, error: "missing 'root_cause'" };
  if (!Array.isArray(obj.handoffs)) return { ok: false, error: "'handoffs' is not an array" };

  for (const f of obj.findings) {
    if (typeof f.id !== "string") return { ok: false, error: "a finding is missing 'id'" };
    if (!f.id.toUpperCase().startsWith(meta.tag + "-")) {
      return { ok: false, error: `finding id '${f.id}' not prefixed with ${meta.tag}-` };
    }
    if (!f.evidence || typeof f.evidence.type !== "string") {
      return { ok: false, error: `finding '${f.id}' missing evidence.type` };
    }
    if (typeof f.severity !== "string") {
      return { ok: false, error: `finding '${f.id}' missing severity` };
    }
  }
  return { ok: true };
}

// Schema check for the reconciled output. Returns { ok, error }.
function checkReconcileSchema(obj) {
  if (typeof obj !== "object" || obj === null) return { ok: false, error: "not an object" };
  if (!Array.isArray(obj.build_order)) return { ok: false, error: "'build_order' is not an array" };
  if (!Array.isArray(obj.do_first)) return { ok: false, error: "'do_first' is not an array" };
  if (!Array.isArray(obj.quick_wins)) return { ok: false, error: "'quick_wins' is not an array" };
  if (!Array.isArray(obj.defer_drop)) return { ok: false, error: "'defer_drop' is not an array" };
  for (const t of obj.build_order) {
    if (typeof t.n !== "number") return { ok: false, error: "a build_order item is missing numeric 'n'" };
    if (typeof t.task !== "string") return { ok: false, error: `build_order ${t.n} missing 'task'` };
  }
  return { ok: true };
}

// Generic validate-with-one-retry. `caller` re-invokes the model with an
// appended prompt; on any failure after the single retry, returns
// { ok:false, error }. Never throws on bad model output.
async function validateWithRetry({ raw, check, caller }) {
  let parsed = tryParse(raw);
  let schema = parsed.ok ? check(parsed.obj) : { ok: false, error: parsed.error };
  if (parsed.ok && schema.ok) return { ok: true, obj: parsed.obj };

  // One retry with the corrective instruction.
  const retryRaw = await caller(RETRY_INSTRUCTION);
  parsed = tryParse(retryRaw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  schema = check(parsed.obj);
  if (!schema.ok) return { ok: false, error: schema.error };
  return { ok: true, obj: parsed.obj };
}

// Validate a lens response. `caller(suffix)` must re-run the same lens prompt
// with `suffix` appended and return the raw string.
export function validateLensJson({ raw, meta, caller }) {
  return validateWithRetry({ raw, check: (o) => checkLensSchema(o, meta), caller });
}

// Validate the reconciliation response.
export function validateReconcileJson({ raw, caller }) {
  return validateWithRetry({ raw, check: checkReconcileSchema, caller });
}
