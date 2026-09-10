/** Shared primitive types for the internal representation (IR) of an OpenAPI document. */

/** Loose JSON object shape used for untrusted parsed spec data. */
export type JsonObject = { [key: string]: unknown };
export type JsonValue = unknown;

/** A parsed OpenAPI document before normalization (untrusted). */
export type RawDocument = unknown;

/** Resolved spec bundle: parsed document plus provenance metadata. */
export interface LoadedSpec {
  /** Parsed document as plain JSON-compatible data. */
  document: JsonValue;
  /** Human-readable source label (file path or ref), used in reports. */
  source: string;
  /** OpenAPI version string as declared in the document (e.g. "3.0.3", "3.1.0"); '' when absent. */
  openapiVersion: string;
  /** Document title or '' when absent. */
  title: string;
  /** sha256 hex digest of the normalized document bytes. */
  sha256: string;
}

/** Internal representation of a normalized spec used by the diff engine. */
export interface NormalizedSpec extends LoadedSpec {
  /** The normalized document (types as arrays, exclusiveMin/Max numeric, etc.). */
  normalized: JsonValue;
}
