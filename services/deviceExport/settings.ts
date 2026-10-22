import { readBrowserPreference, writeBrowserPreference } from '../browserPreferences';
import { RENAMED_PROFILE_IDS, getProfile } from './deviceProfiles';

export interface DeviceExportSettings { devices: string[]; forceGreyscale: boolean; includePdf: boolean }

const KEY = 'doctect-device-export';

/** The picker's remembered choices in this browser; anything unreadable falls back to defaults. */
export function readDeviceExportSettings(defaultForceGreyscale: boolean): DeviceExportSettings {
    const fallback: DeviceExportSettings = { devices: [], forceGreyscale: defaultForceGreyscale, includePdf: false };
    const raw = readBrowserPreference(KEY);
    if (!raw) return fallback;
    try {
        const value = JSON.parse(raw) as Partial<Record<keyof DeviceExportSettings, unknown>>;
        return {
            devices: Array.isArray(value?.devices) ? currentDeviceIds(value.devices) : [],
            forceGreyscale: typeof value?.forceGreyscale === 'boolean' ? value.forceGreyscale : defaultForceGreyscale,
            includePdf: value?.includePdf === true,
        };
    } catch {
        return fallback;
    }
}

/** Remembered ids as today's options: a split option becomes all of its parts; unknown ids drop out. */
function currentDeviceIds(stored: unknown[]): string[] {
    const ids = stored.flatMap(id => (typeof id !== 'string' ? [] : RENAMED_PROFILE_IDS[id] ?? [id]));
    return [...new Set(ids)].filter(id => getProfile(id) !== undefined);
}

export const writeDeviceExportSettings = (settings: DeviceExportSettings): boolean =>
    writeBrowserPreference(KEY, JSON.stringify(settings));
