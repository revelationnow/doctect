import { readBrowserPreference, writeBrowserPreference } from '../browserPreferences';
import { getProfile } from './deviceProfiles';

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
            devices: Array.isArray(value?.devices)
                ? value.devices.filter((id): id is string => typeof id === 'string' && getProfile(id) !== undefined)
                : [],
            forceGreyscale: typeof value?.forceGreyscale === 'boolean' ? value.forceGreyscale : defaultForceGreyscale,
            includePdf: value?.includePdf === true,
        };
    } catch {
        return fallback;
    }
}

export const writeDeviceExportSettings = (settings: DeviceExportSettings): boolean =>
    writeBrowserPreference(KEY, JSON.stringify(settings));
