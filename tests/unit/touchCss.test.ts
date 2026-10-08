import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('index.html', 'utf8');
const HOVER_FILES = [
    'components/sidebar/NodeItem.tsx', 'components/sidebar/TemplateItem.tsx', 'components/TabBar.tsx',
    'components/json/JsonTreeItem.tsx', 'components/json/MainCollectionItem.tsx',
    'components/properties/SingleElementEditor.tsx', 'components/properties/TextPaddingControls.tsx',
];

describe('touch CSS', () => {
    it('scopes every touch rule under data-form-factor', () => {
        const block = html.slice(html.indexOf('/* touch-editor:start */'), html.indexOf('/* touch-editor:end */'));
        expect(block.length).toBeGreaterThan(0);
        const selectors = block.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g) ?? [];
        for (const selector of selectors) {
            for (const part of selector.split(',')) expect(part.trim()).toMatch(/^\[data-form-factor/);
        }
    });

    it('declares 44px targets, 16px form controls, hover reveal and dialog rules', () => {
        expect(html).toMatch(/min-height:\s*44px/);
        expect(html).toMatch(/font-size:\s*16px/);
        expect(html).toContain('group-hover:opacity-100');
        expect(html).toContain('group-hover:flex');
        expect(html).toContain('.editor-dialog-panel');
    });

    it('only uses hover-reveal patterns the touch CSS knows about', () => {
        const known = /(opacity-0 group-hover:opacity-100|hidden group-hover:flex|pointer-events-none[^"'`]*opacity-0)/;
        for (const file of HOVER_FILES) {
            const source = readFileSync(file, 'utf8');
            const uses = source.match(/className=["'`{][^"'`]*group-hover:[^"'`]*/g) ?? [];
            for (const use of uses) {
                if (/opacity-0|\bhidden\b/.test(use)) expect(use, `${file}: ${use}`).toMatch(known);
            }
        }
    });
});
