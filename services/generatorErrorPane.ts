export type GeneratorPane = 'template' | 'hierarchy';

// Preview errors are "<Category>: message" (validation) or "<Script> script exceeds …" (size checks).
// Runtime/clone/protocol errors don't say which script failed, so they map to null and are shown
// only in the header alert.
export function generatorErrorPane(message: string): GeneratorPane | null {
    if (/^Template(:| script\b)/.test(message)) return 'template';
    if (/^Hierarchy(:| script\b)/.test(message)) return 'hierarchy';
    return null;
}
