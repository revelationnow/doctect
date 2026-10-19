// @vitest-environment node
// Node's Blob has arrayBuffer(); jsdom's does not, and JSZip can only read a Blob through FileReader.
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { getProfile } from '../../../services/deviceExport/deviceProfiles';
import { LEGACY_ICON_CODE, createDeviceZip } from '../../../services/deviceExport/bundle';

const rm2 = getProfile('rm2')!;
const manta = getProfile('supernote_manta')!;
const air = getProfile('boox_note_air4c_tab_ultra_c_pro')!;
const bigme = getProfile('bigme_inknote_color')!;
const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
const open = async (blob: Blob) => JSZip.loadAsync(await blob.arrayBuffer());
const methods = { stem: 'doctect-x-guard-rm2-00000000', template: '{"formatVersion":1}', metadata: '{}', content: '{}' };

describe('createDeviceZip', () => {
    it('lays files out per platform and model', async () => {
        const zip = createDeviceZip('Device Export');
        expect(zip.fileName).toBe('Device_Export_device_templates.zip');
        zip.addPng(rm2, 'Guard Page', png(), false);
        zip.addMethods(rm2, methods);
        zip.addPng(manta, 'Guard Page', png(), false);
        zip.addPdf(manta, new Uint8Array([1, 2, 3]).buffer);
        zip.addPng(air, 'Cover', png(), true);
        zip.addPng(bigme, 'Cover', png(), true);
        const files = Object.keys((await open(await zip.finish())).files).filter(name => !name.endsWith('/')).sort();
        expect(files).toEqual([
            'Bigme/inkNote_Color/INSTALL.txt',
            'Bigme/inkNote_Color/noteTemplate/Cover.png',
            'Boox/Note_Air_4C_Tab_Ultra_C_Pro/INSTALL.txt',
            'Boox/Note_Air_4C_Tab_Ultra_C_Pro/noteTemplate/Cover.png',
            'README.txt',
            'Supernote/Manta/INSTALL.txt',
            'Supernote/Manta/MyStyle/Device_Export/Device_Export.pdf',
            'Supernote/Manta/MyStyle/Device_Export/Guard_Page.png',
            'reMarkable/reMarkable_2/INSTALL.txt',
            'reMarkable/reMarkable_2/methods/doctect-x-guard-rm2-00000000.content',
            'reMarkable/reMarkable_2/methods/doctect-x-guard-rm2-00000000.metadata',
            'reMarkable/reMarkable_2/methods/doctect-x-guard-rm2-00000000.template',
            'reMarkable/reMarkable_2/png/Guard_Page.png',
            'reMarkable/reMarkable_2/png/templates.json',
        ]);
    });

    it('writes a templates.json fragment with landscape flags', async () => {
        const zip = createDeviceZip('P');
        zip.addPng(rm2, 'Guard Page', png(), false);
        zip.addPng(rm2, 'Cover', png(), true);
        const raw = await (await open(await zip.finish())).file('reMarkable/reMarkable_2/png/templates.json')!.async('string');
        // The fragment is hand-merged over SSH, so the invisible icon glyph must be written as an escape.
        expect(raw).toContain('\\' + 'ue9fe');
        const json = JSON.parse(raw);
        expect(json).toEqual({ templates: [
            { name: 'Guard Page', filename: 'Guard_Page', iconCode: LEGACY_ICON_CODE, categories: ['Custom'] },
            { name: 'Cover', filename: 'Cover', iconCode: LEGACY_ICON_CODE, categories: ['Custom'], landscape: true },
        ] });
    });

    it('names duplicate and non-Latin titles safely, per folder', async () => {
        const zip = createDeviceZip('P');
        zip.addPng(manta, 'Day', png(), false);
        zip.addPng(manta, 'Day', png(), false);
        zip.addPng(manta, '日記', png(), false);
        zip.addPng(air, 'Day', png(), false);
        const names = Object.keys((await open(await zip.finish())).files).filter(name => name.endsWith('.png')).sort();
        expect(names).toEqual([
            'Boox/Note_Air_4C_Tab_Ultra_C_Pro/noteTemplate/Day.png',
            'Supernote/Manta/MyStyle/P/Day-2.png',
            'Supernote/Manta/MyStyle/P/Day.png',
            'Supernote/Manta/MyStyle/P/page-3.png',
        ]);
    });

    it('adds a conversion report only when there is something to report', async () => {
        const quiet = createDeviceZip('P');
        quiet.addPng(manta, 'Day', png(), false);
        expect((await open(await quiet.finish())).file('CONVERSION-REPORT.txt')).toBeNull();
        const noisy = createDeviceZip('P');
        noisy.addPng(manta, 'Day', png(), false);
        noisy.report('Day (reMarkable 2, .template): images were left out');
        expect(await (await open(await noisy.finish())).file('CONVERSION-REPORT.txt')!.async('string')).toContain('images were left out');
    });

    it('writes install guides that name each device folder', async () => {
        const zip = createDeviceZip('P');
        zip.addPng(rm2, 'A', png(), false);
        zip.addMethods(rm2, methods);
        zip.addPng(manta, 'A', png(), false);
        zip.addPng(air, 'A', png(), false);
        zip.addPng(bigme, 'A', png(), false);
        const out = await open(await zip.finish());
        const read = (path: string) => out.file(path)!.async('string');
        const rm = await read('reMarkable/reMarkable_2/INSTALL.txt');
        expect(rm).toContain('scp methods/* root@10.11.99.1:/home/root/.local/share/remarkable/xochitl/');
        expect(rm).toContain('/usr/share/remarkable/templates/');
        expect(rm).toContain('templates.json');
        expect(await read('Supernote/Manta/INSTALL.txt')).toContain('Note/MyStyle');
        expect(await read('Boox/Note_Air_4C_Tab_Ultra_C_Pro/INSTALL.txt')).toContain('Storage/noteTemplate');
        expect(await read('Bigme/inkNote_Color/INSTALL.txt')).toContain('Storage/noteTemplate');
        expect(await read('README.txt')).toContain('Supernote/Manta');
    });

    it('warns before the reMarkable steps and walks the PNG route through a backed-up templates.json merge', async () => {
        const zip = createDeviceZip('P');
        zip.addPng(rm2, 'A', png(), false);
        zip.addPng(getProfile('rm_pp')!, 'A', png(), false);
        const out = await open(await zip.finish());
        const rm = await out.file('reMarkable/reMarkable_2/INSTALL.txt')!.async('string');
        const pro = await out.file('reMarkable/Paper_Pro/INSTALL.txt')!.async('string');

        // The warning comes before any command.
        expect(rm.indexOf('AT YOUR OWN RISK')).toBeGreaterThan(-1);
        expect(rm.indexOf('AT YOUR OWN RISK')).toBeLessThan(rm.indexOf('ssh '));
        expect(rm).toContain('comfortable');
        // Developer mode wipes only the Paper Pro family; the rM2 has SSH without it.
        expect(pro).toMatch(/developer mode[\s\S]*factory reset/i);
        expect(rm).not.toMatch(/developer mode/i);
        expect(pro).toContain('mount -o remount,rw /');
        expect(rm).not.toContain('mount -o remount,rw /');

        // Option B: back up, merge with a re-runnable jq filter, put it back, restart, find it, undo.
        const steps = [
            'scp png/*.png root@10.11.99.1:/usr/share/remarkable/templates/',
            'scp root@10.11.99.1:/usr/share/remarkable/templates/templates.json tablet-templates.json',
            'cp tablet-templates.json tablet-templates.backup.json',
            "jq -a --slurpfile add png/templates.json",
            "jq '.templates | length' tablet-templates.json merged.json",
            'scp merged.json root@10.11.99.1:/usr/share/remarkable/templates/templates.json',
            'ssh root@10.11.99.1 systemctl restart xochitl',
            'Custom',
            'scp tablet-templates.backup.json root@10.11.99.1:/usr/share/remarkable/templates/templates.json',
        ];
        const optionB = rm.slice(rm.indexOf('Option B'));
        let at = 0;
        for (const step of steps) {
            const found = optionB.indexOf(step, at);
            expect(found, step).toBeGreaterThan(-1);
            at = found + step.length;
        }
    });

    it('sends a reMarkable folder without Methods files to the report instead of an scp that would fail', async () => {
        // Every page of this model hit the .template cap: methods/ is absent, so "scp methods/*" would say "No such file".
        const zip = createDeviceZip('P');
        zip.addPng(rm2, 'A', png(), false);
        zip.report('A (reMarkable 2, .template): too many shapes (30000) for a .template; only the PNG is included');
        const out = await open(await zip.finish());
        const install = await out.file('reMarkable/reMarkable_2/INSTALL.txt')!.async('string');
        expect(install).not.toContain('scp methods/*');
        expect(install).toMatch(/Option A[^\n]*\n[\s\S]*no Methods templates[\s\S]*CONVERSION-REPORT\.txt/);
        expect(install).toContain('Option B');
        expect(Object.keys(out.files).some(name => name.includes('/methods/'))).toBe(false);
    });

    it('points the README at the conversion report, or says there is none', async () => {
        const noisy = createDeviceZip('P');
        noisy.addPng(manta, 'Day', png(), false);
        noisy.report('Day (Manta (A5 X2)): skipped: canvas lost');
        expect(await (await open(await noisy.finish())).file('README.txt')!.async('string')).toMatch(/CONVERSION-REPORT\.txt lists/);
        const quiet = createDeviceZip('P');
        quiet.addPng(manta, 'Day', png(), false);
        expect(await (await open(await quiet.finish())).file('README.txt')!.async('string')).toMatch(/no CONVERSION-REPORT\.txt/);
    });
});
