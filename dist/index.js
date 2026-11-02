import {
  analyze,
  discoverAndLoadConfig,
  generateGatewayShim,
  loadConfigFrom,
  loadSpec,
  renderChangelog,
  renderHtml,
  renderSarif,
  suggestVersion,
  validateSemantics
} from "./chunk-EJQ5XOY6.js";

// src/index.ts
async function validateSpec(specPath, options) {
  const spec = await loadSpec(specPath, { loader: options?.loader });
  const validation = validateSemantics(spec.document, specPath);
  return { spec, validation };
}
export {
  analyze,
  discoverAndLoadConfig,
  generateGatewayShim,
  loadConfigFrom,
  renderChangelog,
  renderHtml,
  renderSarif,
  suggestVersion,
  validateSpec
};
