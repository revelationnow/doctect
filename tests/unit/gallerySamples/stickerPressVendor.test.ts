import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'gallery-samples/21-sticker-press/vendor';
const manifest = () => JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8'));

describe('sticker press vendor', () => {
    it('ships both upstream licence files, non-empty', () => {
        ['LICENSE-lucide', 'LICENSE-twemoji-graphics'].forEach(f => {
            expect(existsSync(`${DIR}/${f}`), f).toBe(true);
            expect(readFileSync(`${DIR}/${f}`, 'utf8').trim().length).toBeGreaterThan(200);
        });
    });

    it('carries both halves of the Lucide licence', () => {
        const t = readFileSync(`${DIR}/LICENSE-lucide`, 'utf8');
        expect(t).toContain('ISC License');
        expect(t).toContain('Lucide Contributors');
        expect(t).toContain('Cole Bemis');           // the Feather-derived MIT half
        expect(t).toContain('MIT License');
    });

    it('carries the Twemoji CC-BY 4.0 graphics licence', () => {
        expect(readFileSync(`${DIR}/LICENSE-twemoji-graphics`, 'utf8')).toContain('Attribution 4.0 International');
    });

    it('has a file on disk for every manifest entry, and no orphans', () => {
        const m = manifest();
        m.icons.forEach((i: any) => {
            expect(existsSync(`${DIR}/${i.source}/${i.id}.svg`), `${i.source}/${i.id}`).toBe(true);
        });
        (['lucide', 'twemoji'] as const).forEach(src => {
            const onDisk = readdirSync(`${DIR}/${src}`).filter(f => f.endsWith('.svg')).map(f => f.replace('.svg', ''));
            const named = new Set(m.icons.filter((i: any) => i.source === src).map((i: any) => i.id));
            onDisk.forEach(id => expect(named.has(id), `orphan ${src}/${id}`).toBe(true));
        });
    });

    it('records byte sizes that match the files, within their per-source cap', () => {
        manifest().icons.forEach((i: any) => {
            const actual = Buffer.byteLength(readFileSync(`${DIR}/${i.source}/${i.id}.svg`, 'utf8'), 'utf8');
            expect(actual, `${i.id} recorded size`).toBe(i.bytes);
            expect(actual, `${i.id} cap`).toBeLessThanOrEqual(i.source === 'twemoji' ? 1500 : 1200);
        });
    });

    it('labels every icon with the licence it falls under', () => {
        manifest().icons.forEach((i: any) => {
            expect(['ISC', 'MIT', 'CC-BY-4.0']).toContain(i.licence);
        });
    });

    it('contains no markup the renderers reject', () => {
        manifest().icons.forEach((i: any) => {
            const s = readFileSync(`${DIR}/${i.source}/${i.id}.svg`, 'utf8');
            expect(s, i.id).toContain('viewBox');
            expect(s, i.id).not.toMatch(/<svg[^>]*\swidth=/);
            expect(s, i.id).not.toMatch(/<(use|script|style|foreignObject)\b/i);
            expect(s, i.id).not.toMatch(/\son[a-z]+=/i);
            expect(s, i.id).not.toMatch(/hsla?\(/i);
            expect(s, i.id).not.toMatch(/currentColor/);   // resolved at vendor time
        });
    });
});
