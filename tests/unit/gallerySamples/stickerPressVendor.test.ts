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
        expect(t).toContain('Lucide Icons and Contributors');
        expect(t).toContain('Cole Bemis');           // the Feather-derived MIT half
        expect(t).toContain('MIT License');
    });

    // GUARDRAIL — TRAP FOR FUTURE REVIEWERS: do not "fix" a diff here by
    // copying node_modules/lucide-react/LICENSE over vendor/LICENSE-lucide.
    // A previous review did exactly that (commit 8f9b7ff, later reverted):
    // it diffed this file against node_modules/lucide-react/LICENSE, saw the
    // copyright notice and Feather clause didn't match, and concluded the
    // vendored text had been "rewritten, not reproduced". It hadn't been.
    // node_modules/lucide-react/LICENSE is a DIFFERENT, OLDER licence
    // snapshot shipped inside an npm package — it is NOT the source the
    // vendored artwork comes from and must never be used as the reference.
    // The artwork in this directory is fetched live from
    // raw.githubusercontent.com/lucide-icons/lucide/main/, and the licence
    // has to travel with that same live snapshot, not with whatever version
    // happened to be locked in node_modules at some earlier point. The two
    // texts differ (copyright holder string, whether the Feather-derived
    // icons are enumerated by name or referenced generically, MIT copyright
    // year) because upstream's LICENSE file changed after the npm dependency
    // was locked — real upstream drift, not fabrication in this codebase.
    // If you're looking at a failure here, go verify against the live URL
    // above before "fixing" it against node_modules.
    it('is the live-upstream licence text, not the older node_modules/lucide-react snapshot', () => {
        const t = readFileSync(`${DIR}/LICENSE-lucide`, 'utf8');

        // Strings that only the live-upstream text carries.
        expect(t).toContain('Copyright (c) 2026 Lucide Icons and Contributors');
        expect(t).toContain('The following Lucide icons are derived from the Feather project:');
        expect(t).toContain('Copyright (c) 2013-present Cole Bemis');

        // Strings unique to the older node_modules/lucide-react snapshot —
        // their presence would mean the vendored licence got re-pinned to
        // the npm copy again.
        expect(t).not.toContain('Lucide Contributors 2025');
        expect(t).not.toContain('Cole Bemis 2013-2023 as part of Feather');

        const npmLicensePath = 'node_modules/lucide-react/LICENSE';
        if (existsSync(npmLicensePath)) {
            // Sharpest form of the guard: the two files must not be
            // byte-identical. If this ever legitimately fails, it means
            // upstream's live LICENSE and the npm package's copy have
            // converged — re-verify against the live URL before touching
            // vendor/LICENSE-lucide.
            expect(t).not.toBe(readFileSync(npmLicensePath, 'utf8'));
        }
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
