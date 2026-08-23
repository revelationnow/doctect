import { readFileSync } from 'node:fs';

const SOURCE_PATH = 'gallery-samples/21-sticker-press/templates.js';

/**
 * The generator script ends with a top-level `return { variants, ... }`, so a test that
 * appends its own `return` would find it unreachable — the script's return wins. It also
 * builds all four variants on the way there, which no builder unit test needs.
 *
 * Everything from the GENERATE sentinel onward is therefore stripped before evaluation,
 * exposing the script's internals directly. Task 11 owns the sentinel; it must stay put.
 */
export const GENERATE_SENTINEL = '// ---- GENERATE (tests strip below this line) ----';

export const stickerPressSource = () => readFileSync(SOURCE_PATH, 'utf8');

export const loadStickerPressScope = (exports: string[]): Record<string, any> => {
    const source = stickerPressSource();
    const cut = source.indexOf(GENERATE_SENTINEL);
    const body = cut === -1 ? source : source.slice(0, cut);
    return new Function(`${body}\nreturn { ${exports.join(', ')} };`)();
};

/** Runs the full script, returning `{ variants, activeVariantId }` as the modal would. */
export const runStickerPressGenerator = (): { variants: Record<string, any>; activeVariantId: string } =>
    new Function(stickerPressSource())();
