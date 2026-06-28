// Central configuration for the QSIF Audit Engine.
// Edit models, lens sets, and toggles here without touching engine code.

export const config = {
  // Model that verifies facts (lenses where the verification rule does real work).
  MODEL_VERIFY: "claude-opus-4-8",
  // Cheaper, still-strong model for the other lenses and for reconciliation.
  MODEL_STANDARD: "claude-sonnet-4-6",

  // Web search must be on for the verification rule to function. Without it every
  // factual finding degrades to "inferred" and Accuracy cannot do its job.
  ENABLE_WEB_SEARCH: true,
  // Lenses that actually call web search (at minimum: accuracy + knowledge).
  WEB_SEARCH_LENSES: ["accuracy", "knowledge"],
  // Lenses that get the heavier verification model.
  VERIFY_LENSES: ["accuracy", "knowledge"],

  // Fan-out concurrency. Lenses are independent; cap to respect rate limits.
  MAX_PARALLEL: 4,

  // Per-call output ceiling.
  MAX_TOKENS: 8000,

  // Lens sets per mode.
  MODES: {
    // All 8.
    flagship: [
      "architecture", "accuracy", "knowledge", "trust",
      "intent", "conversion", "entity", "linguistic",
    ],
    // The 4 that do the core job.
    routine: ["architecture", "accuracy", "trust", "conversion"],
  },

  // Routine is default on purpose: running all eight on every page is slow and
  // noisy enough that people stop trusting it. Flagship is opt-in per run.
  DEFAULT_MODE: "routine",
};

// Lens metadata: id prefix tag + canonical name used in outputs.
export const LENS_META = {
  architecture: { tag: "ARCH", name: "ARCHITECTURE", file: "lens_architecture.md" },
  accuracy:     { tag: "ACC", name: "ACCURACY", file: "lens_accuracy.md" },
  knowledge:    { tag: "KNOW", name: "KNOWLEDGE", file: "lens_knowledge.md" },
  trust:        { tag: "TRUST", name: "TRUST", file: "lens_trust.md" },
  intent:       { tag: "INTENT", name: "INTENT", file: "lens_intent.md" },
  conversion:   { tag: "CONV", name: "CONVERSION", file: "lens_conversion.md" },
  entity:       { tag: "ENTITY", name: "ENTITY", file: "lens_entity.md" },
  linguistic:   { tag: "LING", name: "LINGUISTIC", file: "lens_linguistic.md" },
  competitor:   { tag: "COMP", name: "COMPETITOR", file: "competitor.md" },
};
