// The e-ink models the device export targets. Pixel sizes are portrait; a landscape page swaps
// them (targetBox). `verified` records whether a size was checked on hardware or only against
// the source URL. See docs/superpowers/specs/2026-10-12-device-template-export-design.md §2–3.

export type DevicePlatform = 'remarkable' | 'supernote' | 'boox' | 'bigme';

export interface DeviceProfile {
    id: string;
    platform: DevicePlatform;
    name: string;
    /** Folder name inside the zip. */
    folder: string;
    width: number;
    height: number;
    /** Colour screen: exports keep colour unless greyscale is forced. */
    colour: boolean;
    /** Methods `.template` supportedScreens value (reMarkable only). */
    remarkableScreen?: string;
    /** The device draws the Methods canvas rotated 90° (rM2). */
    rotateMethods?: boolean;
    source: string;
    verified: 'device' | 'docs';
}

export const PLATFORMS: readonly DevicePlatform[] = ['remarkable', 'supernote', 'boox', 'bigme'];

export const PLATFORM_LABELS: Record<DevicePlatform, string> = {
    remarkable: 'reMarkable', supernote: 'Supernote', boox: 'Boox', bigme: 'Bigme',
};

const SUPERNOTE_SIZES = 'https://support.supernote.com/en_US/faq/how-to-create-a-custom-note-template';

export const DEVICE_PROFILES: readonly DeviceProfile[] = [
    { id: 'rm2', platform: 'remarkable', name: 'reMarkable 2', folder: 'reMarkable_2', width: 1404, height: 1872, colour: false,
        remarkableScreen: 'rm2', rotateMethods: true, source: 'https://remarkable.jms1.info/templates/', verified: 'docs' },
    { id: 'rm_pp', platform: 'remarkable', name: 'Paper Pro', folder: 'Paper_Pro', width: 1620, height: 2160, colour: true,
        remarkableScreen: 'rmPP', source: 'https://github.com/chrissyhroberts/remarkable_2_and_paper_pro_custom_templates', verified: 'device' },
    // remarkable.com's product page gives only the 7.3" diagonal; the pixel count is from e-ink-info.
    { id: 'rm_pp_move', platform: 'remarkable', name: 'Paper Pro Move', folder: 'Paper_Pro_Move', width: 954, height: 1696, colour: true,
        remarkableScreen: 'rmPPM', source: 'https://www.e-ink-info.com/remarkable-paper-pro-move', verified: 'docs' },
    { id: 'supernote_a5x_a6x_nomad', platform: 'supernote', name: 'A5 X / A6 X / Nomad (A6 X2)', folder: 'A5X_A6X_Nomad',
        width: 1404, height: 1872, colour: false, source: SUPERNOTE_SIZES, verified: 'docs' },
    { id: 'supernote_manta', platform: 'supernote', name: 'Manta (A5 X2)', folder: 'Manta', width: 1920, height: 2560, colour: false,
        source: SUPERNOTE_SIZES, verified: 'docs' },
    { id: 'boox_note_air3_nova_air', platform: 'boox', name: 'Note Air 3 / Nova Air', folder: 'Note_Air_3_Nova_Air',
        width: 1404, height: 1872, colour: false, source: 'https://shop.boox.com/products/noteair3', verified: 'docs' },
    { id: 'boox_note_air4c_tab_ultra_c_pro', platform: 'boox', name: 'Note Air 4C / Tab Ultra C Pro', folder: 'Note_Air_4C_Tab_Ultra_C_Pro',
        width: 1860, height: 2480, colour: true, source: 'https://shop.boox.com/products/noteair4c', verified: 'docs' },
    { id: 'boox_go_10_3', platform: 'boox', name: 'Go 10.3', folder: 'Go_10_3', width: 1860, height: 2480, colour: false,
        source: 'https://shop.boox.com/products/go103', verified: 'docs' },
    { id: 'boox_go_7', platform: 'boox', name: 'Go 7', folder: 'Go_7', width: 1264, height: 1680, colour: false,
        source: 'https://shop.boox.com/products/go7', verified: 'docs' },
    { id: 'boox_go_color_7', platform: 'boox', name: 'Go Color 7', folder: 'Go_Color_7', width: 1264, height: 1680, colour: true,
        source: 'https://shop.boox.com/products/gocolor7', verified: 'docs' },
    { id: 'boox_note_max', platform: 'boox', name: 'Note Max', folder: 'Note_Max', width: 2400, height: 3200, colour: false,
        source: 'https://shop.boox.com/products/notemax', verified: 'docs' },
    { id: 'boox_palma', platform: 'boox', name: 'Palma', folder: 'Palma', width: 824, height: 1648, colour: false,
        source: 'https://shop.boox.com/products/palma', verified: 'docs' },
    { id: 'bigme_inknote_color', platform: 'bigme', name: 'inkNote Color+ / Color Lite', folder: 'inkNote_Color',
        width: 1860, height: 2480, colour: true, source: 'https://ewritable.net/brands/bigme/tablets/bigme-inknote-color/', verified: 'docs' },
    // The B751C is a 7" Kaleido 3 panel (1264×1680 mono), not the 7.8" 1404×1872 the spec table guessed.
    { id: 'bigme_b751c', platform: 'bigme', name: 'B751c (7″)', folder: 'B751c', width: 1264, height: 1680, colour: true,
        source: 'https://ewritable.net/brands/bigme/tablets/bigme-b751c/', verified: 'docs' },
];

export interface Size { width: number; height: number }

export const getProfile = (id: string): DeviceProfile | undefined => DEVICE_PROFILES.find(profile => profile.id === id);

export const isLandscape = (page: Size): boolean => page.width > page.height;

/** The pixel box a page is rendered into: the profile's size, turned to match the page. */
export const targetBox = (profile: DeviceProfile, page: Size): Size => (
    isLandscape(page) ? { width: profile.height, height: profile.width } : { width: profile.width, height: profile.height }
);

export interface FitRect { scale: number; x: number; y: number; width: number; height: number }

/** Scale `page` to fit inside `box` without distortion, centred (white bands on the short sides). */
export function fitRect(page: Size, box: Size): FitRect {
    const scale = Math.min(box.width / page.width, box.height / page.height);
    const width = page.width * scale;
    const height = page.height * scale;
    return { scale, x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

export const keepsColour = (profile: DeviceProfile, forceGreyscale: boolean): boolean => profile.colour && !forceGreyscale;
