// File and folder names inside the device zip. Devices copy these onto FAT/exFAT storage
// (Supernote rejects \ / : * ?), so names are plain printable ASCII with no reserved characters.

const RESERVED = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
// Windows device names: Explorer cannot extract CON.png or aux.png, and the whole folder fails with them.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export const MAX_NAME_LENGTH = 80;

/** A device-safe name for `raw`, or `fallback` when nothing usable is left. */
export function slugify(raw: string, fallback: string): string {
    // NFKD splits accented letters into base letter + combining mark (U+0300–U+036F), so
    // dropping the marks keeps "Café" readable as "Cafe" instead of losing the letter.
    const ascii = String(raw ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    const cleaned = ascii
        .replace(RESERVED, '')
        .replace(/[^\x20-\x7e]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, MAX_NAME_LENGTH)
        .replace(/^[._-]+|[._-]+$/g, '');
    return cleaned && !WINDOWS_RESERVED.test(cleaned) ? cleaned : fallback;
}

/** Hands out unique names within one folder; case-insensitive, as the device filesystems are. */
export function createNameAllocator(): (base: string) => string {
    const used = new Set<string>();
    return base => {
        let name = base;
        for (let n = 2; used.has(name.toLowerCase()); n += 1) name = withSuffix(base, `-${n}`);
        used.add(name.toLowerCase());
        return name;
    };
}

/** `base` + `suffix`, cutting the base back (and dropping punctuation left at the cut) so the result stays within MAX_NAME_LENGTH. */
function withSuffix(base: string, suffix: string): string {
    const room = MAX_NAME_LENGTH - suffix.length;
    const head = base.length > room ? base.slice(0, room).replace(/[._-]+$/, '') : base;
    return head + suffix;
}
