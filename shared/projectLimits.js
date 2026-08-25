// Ceiling on a stored or published AppState, measured in UTF-8 bytes.
export const MAX_STATE_BYTES = 32 * 1024 * 1024;

// Ceiling on generator output, enforced inside the sandboxed evaluator. This is
// NOT a denial-of-service bound — a hostile script can allocate freely inside
// the worker and simply never emit any output, so this cap (which only
// measures a result string that has already been fully built) can't stop
// that. The actual DoS bounds are the sandbox's 10-second execution timeout
// (services/generatorSandbox.ts SANDBOX_TIMEOUT_MS) and running the script in
// its own Worker, which OS-level resource limits and a hard kill on timeout
// can reclaim independently of anything the script's output looks like. What
// this constant actually guards is a downstream concern: a generator that
// runs to completion and returns something too large to validate, clone
// across the postMessage boundary, or usefully persist. Same value as
// MAX_STATE_BYTES today, but a separate concern: this one guards generation,
// that one guards storage — kept as two constants so they can diverge later
// without one silently governing the other.
export const MAX_GENERATOR_OUTPUT_BYTES = 32 * 1024 * 1024;
export const MAX_NODES = 20000;
export const MAX_VARIANTS = 50;
export const MAX_ELEMENTS = 50000;
export const MAX_TEMPLATE_DIMENSION = 20000;
export const MAX_LAYERS_PER_TEMPLATE = 200;
export const MAX_REFERENCE_DEPTH = 100;
export const MAX_TRAVERSAL_DEPTH = 100;
