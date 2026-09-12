import {
  analyze,
  discoverAndLoadConfig,
  loadConfigFrom,
  loadSpec,
  suggestVersion,
  validateSemantics
} from "./chunk-RQVNHPHC.js";

// src/index.ts
async function validateSpec(specPath, options) {
  const spec = await loadSpec(specPath, { loader: options?.loader });
  const validation = validateSemantics(spec.document, specPath);
  return { spec, validation };
}
export {
  analyze,
  discoverAndLoadConfig,
  loadConfigFrom,
  suggestVersion,
  validateSpec
};
