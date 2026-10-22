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

const PANE_LABEL: Record<GeneratorPane, string> = { template: 'Template script', hierarchy: 'Hierarchy script' };

/** Line of the first syntax error in a generator script, found by parsing it (never running it); null when it parses. */
export async function generatorSyntaxErrorLine(script: string): Promise<number | null> {
    const { parse } = await import('acorn');
    try {
        parse(script, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
        return null;
    } catch (error) {
        const line = (error as { loc?: { line?: unknown } }).loc?.line;
        return typeof line === 'number' ? line : null;
    }
}

// A sandbox failure, worded for the person: which script failed, and on which line when it's a
// syntax error. Messages that already name their script ("Template script must return …") keep it.
export function describeGeneratorFailure(message: string, phase: GeneratorPane, line: number | null): string {
    const label = PANE_LABEL[phase];
    if (!line && message.startsWith(label)) return message;
    return `${label}${line ? `, line ${line}` : ''}: ${message}`;
}
