import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES, PLATFORMS, fitRect, getProfile, keepsColour, targetBox } from '../../../services/deviceExport/deviceProfiles';

describe('device profiles', () => {
    it('are well formed', () => {
        const ids = DEVICE_PROFILES.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const p of DEVICE_PROFILES) {
            expect(PLATFORMS).toContain(p.platform);
            expect(Number.isInteger(p.width) && p.width > 0, p.id).toBe(true);
            expect(Number.isInteger(p.height) && p.height >= p.width, p.id).toBe(true);
            expect(p.source, p.id).toMatch(/^https:\/\//);
            expect(p.folder, p.id).toMatch(/^[A-Za-z0-9_]+$/);
            if (p.platform === 'remarkable') expect(p.remarkableScreen, p.id).toBeTruthy();
            else expect(p.remarkableScreen, p.id).toBeUndefined();
        }
        const folders = DEVICE_PROFILES.map(p => `${p.platform}/${p.folder}`);
        expect(new Set(folders).size).toBe(folders.length);
    });

    it('pins the sizes the manufacturers document', () => {
        expect(getProfile('rm2')).toMatchObject({ width: 1404, height: 1872, colour: false, remarkableScreen: 'rm2', rotateMethods: true });
        expect(getProfile('rm_pp')).toMatchObject({ width: 1620, height: 2160, colour: true, remarkableScreen: 'rmPP' });
        expect(getProfile('supernote_a5x_a6x_nomad')).toMatchObject({ width: 1404, height: 1872, colour: false });
        expect(getProfile('supernote_manta')).toMatchObject({ width: 1920, height: 2560, colour: false });
        expect(getProfile('nope')).toBeUndefined();
    });

    it('swaps the box for landscape pages', () => {
        const rm2 = getProfile('rm2')!;
        expect(targetBox(rm2, { width: 500, height: 700 })).toEqual({ width: 1404, height: 1872 });
        expect(targetBox(rm2, { width: 700, height: 500 })).toEqual({ width: 1872, height: 1404 });
        expect(targetBox(rm2, { width: 600, height: 600 })).toEqual({ width: 1404, height: 1872 });
    });

    it('fits the page inside the box, centred', () => {
        expect(fitRect({ width: 468, height: 624 }, { width: 1404, height: 1872 })).toEqual({ scale: 3, x: 0, y: 0, width: 1404, height: 1872 });
        // A 3:4 page on a 9:16 screen: width limits, white bands top and bottom.
        const tall = fitRect({ width: 600, height: 800 }, { width: 900, height: 1600 });
        expect(tall).toEqual({ scale: 1.5, x: 0, y: 200, width: 900, height: 1200 });
        // A tall page on a wider box: height limits, bands left and right.
        const wide = fitRect({ width: 300, height: 800 }, { width: 900, height: 1600 });
        expect(wide).toEqual({ scale: 2, x: 150, y: 0, width: 600, height: 1600 });
    });

    it('keeps colour only on colour screens unless greyscale is forced', () => {
        expect(keepsColour(getProfile('rm_pp')!, false)).toBe(true);
        expect(keepsColour(getProfile('rm_pp')!, true)).toBe(false);
        expect(keepsColour(getProfile('rm2')!, false)).toBe(false);
    });
});
