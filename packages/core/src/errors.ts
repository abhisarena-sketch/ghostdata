export type ErrorCode =
  | "INVALID_SCHEMA"
  | "INVALID_CONFIG"
  | "PARSE_ERROR"
  | "GENERATION_ERROR"
  | "VALIDATION_ERROR"
  | "LIMIT_EXCEEDED"
  | "UNSUPPORTED";

/** Base class for DataGhost errors. `code` is stable and safe to match on. */
export class DataGhostError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "DataGhostError";
  }
}

export class InvalidSchemaError extends DataGhostError {
  constructor(message: string, readonly path: string, details: string[] = []) {
    super("INVALID_SCHEMA", message, details);
    this.name = "InvalidSchemaError";
  }
}

export class ConfigError extends DataGhostError {
  constructor(message: string, details: string[] = []) {
    super("INVALID_CONFIG", message, details);
    this.name = "ConfigError";
  }
}

export class ParseError extends DataGhostError {
  constructor(message: string, readonly line?: number, details: string[] = []) {
    super("PARSE_ERROR", message, details);
    this.name = "ParseError";
  }
}

export class GenerationError extends DataGhostError {
  constructor(message: string, readonly path?: string) {
    super("GENERATION_ERROR", message);
    this.name = "GenerationError";
  }
}

export class LimitError extends DataGhostError {
  constructor(message: string) {
    super("LIMIT_EXCEEDED", message);
    this.name = "LimitError";
  }
}
