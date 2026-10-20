import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CANVAS_CONTENT_ATTR } from '../../components/Canvas';
import { PILL_INSET_VAR } from '../../components/editor-layout/EditorLayout';

// Guards the touch-only CSS in index.html: every rule lives inside the marked block and is scoped
// under [data-input="touch"] (touch devices) or [data-form-factor] (narrow layouts, touch or mouse),
// and the hover-revealed controls in HOVER_FILES only use patterns the block makes visible on touch,
// or are desktop-only micro-steppers (STEPPER_FILES render a TouchStepper in their place on touch;
// touchStepper.test.tsx covers that).

const html = readFileSync('index.html', 'utf8');
const START = '/* touch-editor:start */';
const END = '/* touch-editor:end */';
const block = html.slice(html.indexOf(START), html.indexOf(END));
const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');

const HOVER_FILES = [
    'components/sidebar/NodeItem.tsx', 'components/sidebar/TemplateItem.tsx', 'components/TabBar.tsx',
    'components/json/JsonTreeItem.tsx', 'components/json/MainCollectionItem.tsx',
    'components/properties/SingleElementEditor.tsx', 'components/properties/TextPaddingControls.tsx',
];
const STEPPER_FILES = ['components/properties/SingleElementEditor.tsx', 'components/properties/TextPaddingControls.tsx'];
const STEPPER_MARK = 'data-micro-stepper';

/** Hide/reveal class pairs the block turns visible, read from rules like `.opacity-0[class~="group-hover:opacity-100"]`. */
const revealPairs = (): Array<[string, string]> =>
    Array.from(rules.matchAll(/\.([\w-]+)\[class~="(group-hover:[\w-]+)"\]/g), m => [m[1], m[2]] as [string, string]);

const LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const HOVER = /^group-hover(?:\/[\w-]+)?:/;
const HIDDEN = /^(?:opacity-0|hidden|invisible)$/;
const REVEALS = /^group-hover(?:\/[\w-]+)?:(?:opacity-(?!0$)\d+|flex|inline-flex|block|inline-block|inline|grid|visible)$/;
const MARK_WINDOW = 3;

type Finding = { line: number; literal: string };

/**
 * Every string or template literal (plain, clsx, ternary, template, named group) that hides an
 * element until group hover and is neither covered by a block rule nor inside a marked desktop-only
 * micro-stepper (the mark must sit on the literal's lines or the MARK_WINDOW lines above it).
 * Classes are matched per literal, so keep a control's hide and reveal classes in the same literal.
 */
function uncoveredHoverReveals(source: string, pairs: Array<[string, string]>): Finding[] {
    const lines = source.split('\n');
    const findings: Finding[] = [];
    for (const match of source.matchAll(LITERAL)) {
        const literal = match[0];
        const tokens = literal.replace(/[`"'${}]/g, ' ').split(/\s+/).filter(Boolean);
        const hover = tokens.filter(token => HOVER.test(token));
        if (hover.length === 0) continue;
        if (!hover.some(token => REVEALS.test(token)) && !tokens.some(token => HIDDEN.test(token))) continue;
        if (pairs.some(([hide, reveal]) => tokens.includes(hide) && tokens.includes(reveal))) continue;
        const line = source.slice(0, match.index).split('\n').length;
        const end = line + literal.split('\n').length - 1;
        if (lines.slice(Math.max(0, line - 1 - MARK_WINDOW), end).some(text => text.includes(STEPPER_MARK))) continue;
        findings.push({ line, literal });
    }
    return findings;
}

describe('touch CSS', () => {
    it('keeps every touch rule inside the marked block, scoped under data-input or data-form-factor', () => {
        expect(block.length).toBeGreaterThan(0);
        const selectors = rules.match(/[^{}]+(?=\{)/g) ?? [];
        expect(selectors.length).toBeGreaterThan(0);
        for (const selector of selectors) {
            for (const part of selector.split(',')) expect(part.trim()).toMatch(/^\[data-input="touch"\]|^\[data-form-factor(=|\])/);
        }
        expect(html.replace(block, '')).not.toMatch(/data-form-factor|data-input/);
    });

    // A narrow mouse window gets the narrow layouts but keeps desktop input: target sizes, form
    // control text, hover reveals, the layer swatch strip and colour inputs follow the pointer.
    it('scopes input rules to touch input, and layout rules to the narrow layouts', () => {
        const scopeOf = (pattern: RegExp) => {
            const found = Array.from(rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)).filter(([, selector, body]) => pattern.test(selector + '{' + body));
            expect(found.length, String(pattern)).toBeGreaterThan(0);
            return found.flatMap(([, selector]) => selector.split(',').map(part => part.trim().split(' ')[0]));
        };
        for (const pattern of [/min-height:\s*44px/, /font-size:\s*16px/, /group-hover:opacity-100/, /group-hover:flex/,
            /\[data-color-popover\]/, /input\[type="color"\]/]) {
            for (const scope of scopeOf(pattern)) expect(scope, String(pattern)).toBe('[data-input="touch"]');
        }
        for (const pattern of [/\.editor-dialog-panel/, /\[data-touch-chrome="top-bar"\]/, /\[data-canvas-content\]/,
            /\[data-touch-pill-scroller\]/, /\[data-editor-shell\]/]) {
            for (const scope of scopeOf(pattern)) expect(scope, String(pattern)).toMatch(/^\[data-form-factor(=|\])/);
        }
    });

    it('declares 44px targets, 16px form controls, hover reveal and dialog rules', () => {
        expect(block).toMatch(/min-height:\s*44px/);
        expect(block).toMatch(/font-size:\s*16px/);
        expect(block).toContain('group-hover:opacity-100');
        expect(block).toContain('group-hover:flex');
        expect(block).toContain('.editor-dialog-panel');
        // Touch renders TouchStepper instead of the micro-steppers, so no rule hides (or sizes) them.
        expect(rules).not.toContain(STEPPER_MARK);
    });

    it('pads only the canvas content wrapper for the phone tool pill, by the names the layout and Canvas export', () => {
        const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const scrollRoom = new RegExp(
            `\\[data-form-factor="phone"\\] \\[${escape(CANVAS_CONTENT_ATTR)}\\]\\s*\\{\\s*padding-bottom:\\s*calc\\(1rem \\+ var\\(${escape(PILL_INSET_VAR)}, 0px\\)\\);\\s*\\}`,
        );
        expect(rules).toMatch(scrollRoom);
        // The scroll container's other direct child is the long-press select-under menu, which must
        // keep its own padding: never pad by position.
        expect(rules).not.toMatch(/\.canvas-scroll-container\s*>/);
    });

    // Mobile browsers size 100vh with the address bar hidden: on a first load the bar shows and a
    // 100vh shell put the phone sheet below the screen. The touch shell follows the visible viewport.
    it('sizes the touch editor shell to the dynamic viewport, which the editor page marks', () => {
        expect(rules).toMatch(/\[data-form-factor\] \[data-editor-shell\]\s*\{\s*height:\s*100dvh;\s*\}/);
        expect(readFileSync('pages/EditorPage.tsx', 'utf8')).toMatch(/data-editor-shell=""\s*\n\s*className="flex h-screen /);
    });

    // No engine may open its platform colour picker from a tap (Firefox for Android ignores a
    // cancelled click); TouchColorPickerHost hit-tests the tap instead.
    it('takes pointer events away from colour inputs on touch', () => {
        expect(rules).toMatch(/\[data-input="touch"\] input\[type="color"\]\s*\{\s*pointer-events:\s*none;\s*\}/);
    });

    it('only uses hover-reveal patterns the touch CSS knows about', () => {
        const pairs = revealPairs();
        expect(pairs).toEqual(expect.arrayContaining([['opacity-0', 'group-hover:opacity-100'], ['hidden', 'group-hover:flex']]));
        for (const file of HOVER_FILES) {
            expect(uncoveredHoverReveals(readFileSync(file, 'utf8'), pairs), file).toEqual([]);
        }
    });

    it('marks the desktop-only micro-steppers and renders the touch stepper in their place', () => {
        for (const file of STEPPER_FILES) {
            const source = readFileSync(file, 'utf8');
            expect(source, file).toContain(STEPPER_MARK);
            expect(source, file).toMatch(/useFormFactor\(\) !== 'desktop'/);
            expect(source, file).toContain('<TouchStepper');
        }
    });

    it('flags uncovered hover reveals written as clsx, template, ternary or named-group literals', () => {
        const pairs = revealPairs();
        const rejected: Record<string, string> = {
            clsx: '<button className={clsx("p-1 opacity-0 group-hover:opacity-50", active && "text-blue-600")} />',
            template: '<div className={`hidden ${wide ? "w-full" : ""} group-hover:block`} />',
            ternary: "<div className={disabled ? 'opacity-0' : 'opacity-0 group-hover:opacity-75'} />",
            namedGroup: '<div className="opacity-0 group-hover/row:opacity-100" />',
        };
        for (const [name, source] of Object.entries(rejected)) expect(uncoveredHoverReveals(source, pairs), name).toHaveLength(1);

        const accepted: Record<string, string> = {
            plain: '<div className="ml-auto opacity-0 group-hover:opacity-100 p-1" />',
            clsx: '<button className={clsx("p-0.5 opacity-0 group-hover:opacity-100", active ? "a" : "b")} />',
            template: '<div className={`hidden group-hover:flex ${extra}`} />',
            hoverTint: '<div className="text-slate-400 group-hover:text-slate-600" />',
            stepper: '<div data-micro-stepper className="opacity-0 group-hover/stepper:opacity-100" />',
            stepperAbove: [
                '<div',
                '    data-micro-stepper',
                "    className={`flex ${disabled ? 'opacity-0' : 'opacity-0 group-hover/stepper:opacity-100'}`}",
                '/>',
            ].join('\n'),
        };
        for (const [name, source] of Object.entries(accepted)) expect(uncoveredHoverReveals(source, pairs), name).toEqual([]);
    });
});
