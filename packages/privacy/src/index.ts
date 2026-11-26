export * from "./detect.js";
export * from "./transform.js";
export * from "./safety.js";

/**
 * Plain-language limitations shown by the CLI, SDK reports and playground.
 * Detection is not protection; masking is not anonymisation.
 */
export const PRIVACY_LIMITATIONS: readonly string[] = [
  "Sensitive-field detection is heuristic. It flags potential personal data from field names, value patterns and context; it can miss fields and can flag harmless ones.",
  "Masking and pseudonymisation do not guarantee anonymisation. Remaining fields, rare values and combinations of quasi-identifiers (postal code, birth date, gender) can still re-identify people.",
  "Synthetic mode creates new values from the inferred schema, but enumerated values and value ranges are learned from the source. Review enums before sharing output.",
  "Seeded masking is reproducible: anyone with the seed and candidate inputs could test guesses. Use an unseeded run (random secret) when output leaves your team.",
  "Passwords, tokens and API keys are always redacted or replaced and never copied from the source.",
  "DataGhost processes data locally. It does not upload datasets, call external services or collect telemetry.",
];
