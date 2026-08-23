// Ceiling on a stored or published AppState, measured in UTF-8 bytes.
export const MAX_STATE_BYTES = 16 * 1024 * 1024;

// Ceiling on generator output, enforced inside the sandboxed evaluator as a
// denial-of-service bound on hostile script source. Same value as
// MAX_STATE_BYTES today, but a separate concern: this one guards the browser
// during evaluation, that one guards storage.
export const MAX_GENERATOR_OUTPUT_BYTES = 16 * 1024 * 1024;
export const MAX_NODES = 20000;
export const MAX_VARIANTS = 50;
export const MAX_ELEMENTS = 50000;
export const MAX_TEMPLATE_DIMENSION = 20000;
export const MAX_LAYERS_PER_TEMPLATE = 200;
export const MAX_REFERENCE_DEPTH = 100;
export const MAX_TRAVERSAL_DEPTH = 100;
