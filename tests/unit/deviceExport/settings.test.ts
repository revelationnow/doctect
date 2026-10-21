import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDeviceExportSettings, writeDeviceExportSettings } from '../../../services/deviceExport/settings';

const KEY = 'doctect-device-export';
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('device export settings', () => {
    it('defaults when nothing is stored', () => {
        expect(readDeviceExportSettings(true)).toEqual({ devices: [], forceGreyscale: true, includePdf: false });
    });

    it('round-trips and drops device ids that no longer exist', () => {
        expect(writeDeviceExportSettings({ devices: ['rm2', 'gone'], forceGreyscale: false, includePdf: true })).toBe(true);
        expect(readDeviceExportSettings(true)).toEqual({ devices: ['rm2'], forceGreyscale: false, includePdf: true });
    });

    it('carries a remembered option that was split into its parts', () => {
        localStorage.setItem(KEY, JSON.stringify({ devices: ['supernote_a5x_a6x_nomad', 'supernote_a5x', 'boox_note_air3_nova_air'], forceGreyscale: false, includePdf: false }));
        expect(readDeviceExportSettings(false).devices).toEqual(['supernote_a5x', 'supernote_nomad', 'boox_note_air3', 'boox_nova_air']);
    });

    it('survives corrupt JSON and a throwing storage', () => {
        localStorage.setItem(KEY, '{not json');
        expect(readDeviceExportSettings(false)).toEqual({ devices: [], forceGreyscale: false, includePdf: false });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        expect(readDeviceExportSettings(false)).toEqual({ devices: [], forceGreyscale: false, includePdf: false });
    });
});
