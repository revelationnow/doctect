export type GeneratorPane = 'template' | 'hierarchy';

// The sandbox reports which script was compiling or running when it failed (`phase`); that wins.
// Without it, validation errors are "<Category>: message" and size checks are "<Script> script exceeds …",
// so the prefix names the pane. Runtime/clone/protocol/timeout errors that carry no phase map to null
// and are shown only in the header alert.
export function generatorErrorPane(message: string, phase?: GeneratorPane | null): GeneratorPane | null {
    if (phase) return phase;
    if (/^Template(:| script\b)/.test(message)) return 'template';
    if (/^Hierarchy(:| script\b)/.test(message)) return 'hierarchy';
    return null;
}
