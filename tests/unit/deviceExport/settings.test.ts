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

    it('survives corrupt JSON and a throwing storage', () => {
        localStorage.setItem(KEY, '{not json');
        expect(readDeviceExportSettings(false)).toEqual({ devices: [], forceGreyscale: false, includePdf: false });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        expect(readDeviceExportSettings(false)).toEqual({ devices: [], forceGreyscale: false, includePdf: false });
    });
});
