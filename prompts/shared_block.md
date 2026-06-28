=== VERIFICATION RULE ===
Before asserting any factual claim about the domain or its current state, verify against current authoritative primary sources using web search. The page may be stale; your training may be stale; the sources decide. Tag every finding's evidence as one of:
- verified  (include the source)
- inferred  (reasoning only, no external source)
- opinion   (judgment call)
Never present inferred or opinion as fact. On YMYL topics, if a factual claim cannot be verified, downgrade or omit it.

=== OUTPUT FORMAT (STRICT JSON) ===
Return ONE valid JSON object and NOTHING else. No prose, no markdown, no code fences, no preamble. Conform exactly to this shape:
{
  "lens": "<LENS_TAG>",
  "calibration": { "page_type":"", "primary_audience":"", "secondary_audience":"", "awareness_stage":"", "decision_stage":"", "expertise_bar":"" },
  "findings": [
    { "id":"<TAG>-01", "finding":"", "evidence":{ "type":"verified|inferred|opinion", "source":"" }, "severity":"Foundational|High|Medium|Low", "impact":"", "fix":"", "confidence":"H|M|L" }
  ],
  "root_cause": "",
  "handoffs": [ { "lens":"", "issue":"" } ]
}

=== FINDINGS RULES ===
- Rank findings by severity, then impact. Cap at the top 12. Cut anything below Medium unless it is Foundational. Quality over count.
- Every id is prefixed with this lens's tag.
- handoffs = issues you noticed that belong to ANOTHER lens. Name the lens and the issue in one line each. Do NOT analyze them. This is how the lenses stay separate.

=== QUALITY RULES ===
- No praise. No generic SEO advice (titles, meta, backlinks, speed) unless it directly changes this lens's subject. Do not restate strengths.
- Do not assume the page ranks. If a foundational problem exists, surface it first.
- Treat the listed roles as working hats: reason from them, do not announce them.
- No fabricated metrics. If you cannot observe something without inventing a number, describe it ordinally (high/medium/low) or omit it.
- Stay strictly inside Scope. The handoff list is how you avoid poaching an adjacent lens.
