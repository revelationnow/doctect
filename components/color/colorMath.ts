/** Hue 0–360, saturation and value 0–1. */
export interface Hsv { h: number; s: number; v: number }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** `#rgb`/`#rrggbb`, with or without the `#`, to lowercase `#rrggbb`; null for anything else. */
export function normalizeHex(input: string): string | null {
    const raw = input.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map(c => c + c).join('')}`.toLowerCase();
    if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`.toLowerCase();
    return null;
}

/** `hint` keeps the hue (and saturation) of greys and black, which a hex alone cannot carry. */
export function hexToHsv(hex: string, hint?: Hsv): Hsv {
    const value = normalizeHex(hex) ?? '#000000';
    const [r, g, b] = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    let h = hint?.h ?? 0;
    if (delta > 0) {
        if (max === r) h = 60 * (((g - b) / delta) % 6);
        else if (max === g) h = 60 * ((b - r) / delta + 2);
        else h = 60 * ((r - g) / delta + 4);
        if (h < 0) h += 360;
    }
    const s = max === 0 ? (hint?.s ?? 0) : delta / max;
    return { h, s, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
    const sat = clamp01(s);
    const val = clamp01(v);
    const hue = ((h % 360) + 360) % 360;
    const f = (n: number) => {
        const k = (n + hue / 60) % 6;
        return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return `#${[f(5), f(3), f(1)].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
}
