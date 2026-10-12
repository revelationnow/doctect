import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { seedNativeProject } from './localWorkspaceHelpers.js';
import { layoutFixture } from './fixtures/layoutFixture.js';

// Device template export from the desktop editor: picker defaults, a multi-platform zip, PNG pixel
// sizes per model, landscape handling, the legacy templates.json fragment and Methods files.
const fixture = structuredClone(layoutFixture);
const page = (id, type, title) => ({ id, parentId: 'root', type, title, data: {}, children: [] });
fixture.nodes.root.children = ['day1', 'day2', 'cover'];
fixture.nodes.day1 = page('day1', 'page', 'Day 1');
fixture.nodes.day2 = page('day2', 'page', 'Day 2');
fixture.nodes.cover = page('cover', 'cover', 'Cover');
fixture.variants.default.templates.cover = {
    id: 'cover', name: 'Cover', width: 842, height: 595,
    layers: [{ id: 'base', name: 'Base', order: 0, visible: true, locked: false }],
    elements: [{ id: 'band', type: 'rect', layerId: 'base', x: 40, y: 40, w: 300, h: 80, rotation: 0,
        fill: '#94a3b8', stroke: '#000000', strokeWidth: 2, opacity: 1 }],
};

const activePane = p => p.locator('[data-testid="project-pane"][data-active="true"]');
const pngSize = bytes => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
const pathLetters = value => Array.isArray(value) ? value.flatMap(pathLetters)
    : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, v]) => (key === 'data' ? v.filter(t => /^[A-Z]$/.test(t)) : pathLetters(v)))
        : [];

test.beforeEach(async ({ page: browserPage }) => {
    await seedNativeProject(browserPage, { id: 'device-export', name: 'Device Export', initialState: fixture });
    await browserPage.goto('/app');
    await expect(activePane(browserPage).getByTestId('editor-canvas')).toBeVisible();
});

test('exports chosen pages for several devices as one zip', async ({ page: browserPage }) => {
    await browserPage.getByRole('button', { name: 'Devices' }).click();
    const dialog = browserPage.getByRole('dialog', { name: 'Export for device' });
    await expect(dialog.getByRole('checkbox', { name: 'Guard Page' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Day 1' })).not.toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Cover', exact: true })).toBeChecked();

    for (const name of ['reMarkable 2', 'Manta (A5 X2)', 'Note Air 4C / Tab Ultra C Pro']) {
        await dialog.getByRole('checkbox', { name }).check();
    }
    await dialog.getByRole('checkbox', { name: 'Also include a PDF template' }).check();
    await expect(dialog.getByRole('status')).toHaveText('2 pages × 3 devices = 6 templates (.zip)');

    const downloadPromise = browserPage.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Device_Export_device_templates.zip');
    await expect(dialog).toBeHidden();

    const zip = await JSZip.loadAsync(await readFile(await download.path()));
    const size = async path => pngSize(Buffer.from(await zip.file(path).async('uint8array')));
    expect(await size('reMarkable/reMarkable_2/png/Guard_Page.png')).toEqual({ width: 1404, height: 1872 });
    expect(await size('reMarkable/reMarkable_2/png/Cover.png')).toEqual({ width: 1872, height: 1404 });
    expect(await size('Supernote/Manta/MyStyle/Device_Export/Guard_Page.png')).toEqual({ width: 1920, height: 2560 });
    expect(await size('Boox/Note_Air_4C_Tab_Ultra_C_Pro/noteTemplate/Cover.png')).toEqual({ width: 2480, height: 1860 });
    expect((await zip.file('Supernote/Manta/MyStyle/Device_Export/Device_Export.pdf').async('uint8array')).length).toBeGreaterThan(100);
    expect(zip.file('README.txt')).toBeTruthy();

    const legacy = JSON.parse(await zip.file('reMarkable/reMarkable_2/png/templates.json').async('string'));
    expect(legacy.templates.map(t => [t.filename, Boolean(t.landscape)])).toEqual([['Guard_Page', false], ['Cover', true]]);

    const methods = zip.file(/^reMarkable\/reMarkable_2\/methods\/.*\.template$/);
    expect(methods).toHaveLength(2);
    for (const file of methods) {
        const template = JSON.parse(await file.async('string'));
        expect(template).toMatchObject({ formatVersion: 1, supportedScreens: ['rm2'], categories: ['Custom'] });
        expect(new Set(pathLetters(template.items)).size).toBeGreaterThan(0);
        for (const letter of pathLetters(template.items)) expect(['M', 'L', 'Z']).toContain(letter);
    }
});
