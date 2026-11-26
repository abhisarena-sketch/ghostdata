export { DataGhost, scaleCounts, type DataGhostOptions, type GenerateOptions, type SynthesizeOptions, type TransformCallOptions, type DataInput } from "./dataghost.js";
export * from "./errors.js";
export * from "./schema.js";
export * from "./engine.js";
export * from "./config.js";
export * from "./formats/index.js";
export * from "./inference/infer.js";
export * from "./inference/stats.js";
export { detectSemantic, type GeneratorSuggestion, type SemanticGuess } from "./inference/semantic.js";
export * from "./inspect.js";
export * from "./modes.js";
export * from "./validate.js";

// Re-export the building blocks so SDK users need a single dependency.
export {
  GENERATOR_VERSION,
  GeneratorRegistry,
  defaultRegistry,
  createRng,
  type GeneratorContext,
  type GeneratorFn,
  type GeneratorDefinition,
  type Rng,
  type Seed,
} from "@workfonic/dataghost-generators";
export {
  classifyField,
  scanRecord,
  PRIVACY_LIMITATIONS,
  TRANSFORMATIONS,
  type PrivacyClassification,
  type SensitiveCategory,
  type SensitivityLevel,
  type Transformation,
} from "@workfonic/dataghost-privacy";
export {
  detectRelationships,
  validateIntegrity,
  CircularDependencyError,
  ReferentialIntegrityError,
  RelationshipConfigError,
  type RelationshipConfig,
  type RelationshipType,
  type IntegrityReport,
  type SuggestedRelationship,
} from "@workfonic/dataghost-relationships";
