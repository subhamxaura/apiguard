/** Exit codes per spec §17. */
export const ExitCode = {
  Ok: 0,
  BreakingChanges: 1,
  Usage: 2,
  SpecError: 3,
  Internal: 4,
  Sigint: 130,
} as const;

/** Base class for all apiguard errors; carries the process exit code to use. */
export abstract class ApiguardError extends Error {
  abstract readonly exitCode: number;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Invalid CLI arguments or flags. Exit 2. */
export class CliUsageError extends ApiguardError {
  readonly exitCode = ExitCode.Usage;
  constructor(message: string) {
    super(message);
  }
}

/** Config file missing, unparsable, or invalid. Exit 2. */
export class ConfigError extends ApiguardError {
  readonly exitCode = ExitCode.Usage;
  constructor(message: string) {
    super(message);
  }
}

/** Spec could not be loaded/parsed. Exit 3. */
export class SpecLoadError extends ApiguardError {
  readonly exitCode = ExitCode.SpecError;
  constructor(message: string) {
    super(message);
  }
}

/** Spec loaded but failed validation (structural or semantic). Exit 3. */
export class SpecValidationError extends ApiguardError {
  readonly exitCode = ExitCode.SpecError;
  constructor(message: string) {
    super(message);
  }
}

/** Unexpected internal error. Exit 4. */
export class InternalError extends ApiguardError {
  readonly exitCode = ExitCode.Internal;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Format an unknown thrown value into a readable message. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
