// The e-ink models the device export targets. Pixel sizes are portrait; a landscape page swaps
// them (targetBox). `verified` records whether a size was checked on hardware or only against
// the source URL. See docs/superpowers/specs/2026-10-12-device-template-export-design.md §2–3.

export type DevicePlatform = 'remarkable' | 'supernote' | 'boox' | 'bigme' | 'kindle' | 'kobo' | 'pocketbook' | 'generic';

export interface DeviceProfile {
    id: string;
    platform: DevicePlatform;
    /** The option's main label: the current model with this screen. */
    name: string;
    /** Other models with the same screen (pixels, size and colour), shown under the name. */
    also?: string;
    /** Screen diagonal in inches, shown beside the name. */
    inches: number;
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

export const PLATFORMS: readonly DevicePlatform[] = ['remarkable', 'supernote', 'boox', 'bigme', 'kindle', 'kobo', 'pocketbook', 'generic'];

/** Also the top-level folder names in the zip. */
export const PLATFORM_LABELS: Record<DevicePlatform, string> = {
    remarkable: 'reMarkable', supernote: 'Supernote', boox: 'Boox', bigme: 'Bigme',
    kindle: 'Kindle', kobo: 'Kobo', pocketbook: 'PocketBook', generic: 'Generic',
};

const SUPERNOTE_SIZES = 'https://support.supernote.com/en_US/faq/how-to-create-a-custom-note-template';

// One option per screen: models share an option only when pixels, diagonal and colour all match,
// so "also" never hides a different physical size. Largest screen first within a brand. Sizes
// checked 2026-10-21 against the sources.
export const DEVICE_PROFILES: readonly DeviceProfile[] = [
    { id: 'rm_pp', platform: 'remarkable', name: 'Paper Pro', inches: 11.8, folder: 'Paper_Pro', width: 1620, height: 2160, colour: true,
        remarkableScreen: 'rmPP', source: 'https://github.com/chrissyhroberts/remarkable_2_and_paper_pro_custom_templates', verified: 'device' },
    // Paper Pure (2026) replaced the rM2 with the same 10.3" 1404×1872 panel. The Methods screen code
    // is the rM2's; it is unconfirmed on Paper Pure, whose PNG route needs no screen code.
    { id: 'rm2', platform: 'remarkable', name: 'Paper Pure', also: 'reMarkable 2', inches: 10.3, folder: 'Paper_Pure_reMarkable_2', width: 1404, height: 1872, colour: false,
        remarkableScreen: 'rm2', rotateMethods: true, source: 'https://remarkable.com/products/remarkable-paper/pure/details/compare', verified: 'docs' },
    // remarkable.com's product page gives only the 7.3" diagonal; the pixel count is from e-ink-info.
    { id: 'rm_pp_move', platform: 'remarkable', name: 'Paper Pro Move', inches: 7.3, folder: 'Paper_Pro_Move', width: 954, height: 1696, colour: true,
        remarkableScreen: 'rmPPM', source: 'https://www.e-ink-info.com/remarkable-paper-pro-move', verified: 'docs' },


    { id: 'supernote_manta', platform: 'supernote', name: 'Manta', also: 'A5 X2', inches: 10.7, folder: 'Manta', width: 1920, height: 2560, colour: false,
        source: SUPERNOTE_SIZES, verified: 'docs' },
    { id: 'supernote_a5x', platform: 'supernote', name: 'A5 X', inches: 10.3, folder: 'A5X', width: 1404, height: 1872, colour: false,
        source: SUPERNOTE_SIZES, verified: 'docs' },
    { id: 'supernote_nomad', platform: 'supernote', name: 'Nomad', also: 'A6 X2 · A6 X', inches: 7.8, folder: 'Nomad_A6X', width: 1404, height: 1872, colour: false,
        source: SUPERNOTE_SIZES, verified: 'docs' },

    { id: 'boox_note_max', platform: 'boox', name: 'Note Max', inches: 13.3, folder: 'Note_Max', width: 2400, height: 3200, colour: false,
        source: 'https://shop.boox.com/products/notemax', verified: 'docs' },
    { id: 'boox_tab_x_c', platform: 'boox', name: 'Tab X C', inches: 13.3, folder: 'Tab_X_C', width: 2400, height: 3200, colour: true,
        source: 'https://blog.the-ebook-reader.com/2025/04/29/boox-tab-x-c-with-13-3-color-e-ink-screen-released-videos/', verified: 'docs' },
    { id: 'boox_note_air4c_tab_ultra_c_pro', platform: 'boox', name: 'Note Air C', also: 'Air3 C to Air6 C · Tab Ultra C Pro', inches: 10.3, folder: 'Note_Air_C',
        width: 1860, height: 2480, colour: true, source: 'https://shop.boox.com/products/noteair5c', verified: 'docs' },
    { id: 'boox_go_10_3', platform: 'boox', name: 'Go 10.3', also: 'Gen II · Lumi', inches: 10.3, folder: 'Go_10_3', width: 1860, height: 2480, colour: false,
        source: 'https://shop.boox.com/products/go103', verified: 'docs' },
    { id: 'boox_note_air3', platform: 'boox', name: 'Note Air3', inches: 10.3, folder: 'Note_Air3', width: 1404, height: 1872, colour: false,
        source: 'https://shop.boox.com/products/boox-note-air3', verified: 'docs' },
    { id: 'boox_note_mini_c', platform: 'boox', name: 'Note Mini C', inches: 8.5, folder: 'Note_Mini_C', width: 1536, height: 2048, colour: true,
        source: 'https://www.notebookcheck.net/Boox-Note-Mini-C-launches-iPad-Mini-sized-e-reader-with-Android-16-and-Kaleido-3-color-E-Ink-display.1401191.0.html', verified: 'docs' },
    { id: 'boox_tab_mini_c', platform: 'boox', name: 'Tab Mini C', also: 'Nova Air C', inches: 7.8, folder: 'Tab_Mini_C', width: 1404, height: 1872, colour: true,
        source: 'https://blog.the-ebook-reader.com/2023/06/25/new-onyx-boox-tab-mini-c-with-7-8-color-e-ink-screen/', verified: 'docs' },
    { id: 'boox_nova_air', platform: 'boox', name: 'Nova Air', also: 'Nova Air 2', inches: 7.8, folder: 'Nova_Air', width: 1404, height: 1872, colour: false,
        source: 'https://goodereader.com/blog/?p=242740', verified: 'docs' },
    { id: 'boox_go_7', platform: 'boox', name: 'Go 7', inches: 7, folder: 'Go_7', width: 1264, height: 1680, colour: false,
        source: 'https://www.bhphotovideo.com/c/product/1893399-REG/boox_opc1328r_7_go_7_epaper.html', verified: 'docs' },
    { id: 'boox_go_color_7', platform: 'boox', name: 'Go Color 7', also: 'Gen II', inches: 7, folder: 'Go_Color_7', width: 1264, height: 1680, colour: true,
        source: 'https://www.techradar.com/tablets/ereaders/onyx-boox-go-color-7-gen-ii-review', verified: 'docs' },
    { id: 'boox_palma', platform: 'boox', name: 'Palma 3', inches: 6.1, folder: 'Palma_3', width: 824, height: 1648, colour: false,
        source: 'https://www.notebookcheck.net/Boox-Palma-3-launched-with-with-6-13-inch-E-Ink-display-stylus-support-and-Android-16.1400897.0.html', verified: 'docs' },
    { id: 'boox_palma_2_pro', platform: 'boox', name: 'Palma 2 Pro', inches: 6.1, folder: 'Palma_2_Pro', width: 824, height: 1648, colour: true,
        source: 'https://www.notebookcheck.net/Boox-launches-Palma-2-Pro-e-reader-with-a-color-display-5G-connectivity-and-stylus-support.1143278.0.html', verified: 'docs' },

    { id: 'bigme_inknote_color', platform: 'bigme', name: 'B10', also: 'B1051C · inkNote Color+ · Color Lite', inches: 10.3, folder: 'B10_inkNote_Color',
        width: 1860, height: 2480, colour: true, source: 'https://www.androidauthority.com/bigme-b10-tablet-launch-3637013/', verified: 'docs' },
    { id: 'bigme_galy', platform: 'bigme', name: 'Galy', inches: 8, folder: 'Galy', width: 1440, height: 1920, colour: true,
        source: 'https://www.parkablogs.com/content/review-bigme-galy-worlds-first-e-ink-gallery-3-tablet', verified: 'docs' },
    // The B751C is a 7" Kaleido 3 panel (1264×1680 mono), not the 7.8" 1404×1872 the spec table guessed.
    { id: 'bigme_b751c', platform: 'bigme', name: 'B751C', also: 'B751C S · B7', inches: 7, folder: 'B751C_B7', width: 1264, height: 1680, colour: true,
        source: 'https://www.parkablogs.com/content/bigme-b751c-s-colour-e-ink-tablet-review', verified: 'docs' },

    // Amazon publishes only "300 ppi" for the 11" Scribes; 1980×2640 is the 11" 3:4 grid at 300 ppi, from reviews.
    { id: 'kindle_scribe_11', platform: 'kindle', name: 'Scribe (2025)', inches: 11, folder: 'Scribe_2025', width: 1980, height: 2640, colour: false,
        source: 'https://goodereader.com/blog/electronic-readers/amazon-kindle-scribe-3-full-review', verified: 'docs' },
    { id: 'kindle_scribe_colorsoft', platform: 'kindle', name: 'Scribe Colorsoft', inches: 11, folder: 'Scribe_Colorsoft', width: 1980, height: 2640, colour: true,
        source: 'https://techradar.com/tablets/ereaders/amazon-kindle-scribe-colorsoft-review', verified: 'docs' },
    { id: 'kindle_scribe_10_2', platform: 'kindle', name: 'Scribe (2022, 2024)', inches: 10.2, folder: 'Scribe_2022_2024', width: 1860, height: 2480, colour: false,
        source: 'https://comparisontabl.es/e-readers/kindle-scribe-vs-kindle-scribe-2024/', verified: 'docs' },

    { id: 'kobo_elipsa_2e', platform: 'kobo', name: 'Elipsa 2E', inches: 10.3, folder: 'Elipsa_2E', width: 1404, height: 1872, colour: false,
        source: 'https://comparisontabl.es/e-readers/kobo-libra-colour-vs-kobo-elipsa-2e/', verified: 'docs' },
    { id: 'kobo_sage', platform: 'kobo', name: 'Sage', inches: 8, folder: 'Sage', width: 1440, height: 1920, colour: false,
        source: 'https://www.trustedreviews.com/news/kobo-announces-sage-and-libra-2-e-readers-4171075', verified: 'docs' },
    { id: 'kobo_libra_colour', platform: 'kobo', name: 'Libra Colour', inches: 7, folder: 'Libra_Colour', width: 1264, height: 1680, colour: true,
        source: 'https://help.kobo.com/hc/en-us/articles/17971574287895-Kobo-Libra-Colour', verified: 'docs' },

    { id: 'pocketbook_inkpad_eo', platform: 'pocketbook', name: 'InkPad Eo', also: 'InkPad Eo 2', inches: 10.3, folder: 'InkPad_Eo', width: 1860, height: 2480, colour: true,
        source: 'https://pocketbook.ch/en-ch/news/pocketbook-inkpad-eo-news-ch', verified: 'docs' },
    { id: 'pocketbook_color_note', platform: 'pocketbook', name: 'Color Note', inches: 10.3, folder: 'Color_Note', width: 1404, height: 1872, colour: true,
        source: 'https://pocketbook.ch/en-ch/news/pocketbook-color-note-news-ch', verified: 'docs' },
    { id: 'pocketbook_inkpad_one', platform: 'pocketbook', name: 'InkPad One', also: 'InkPad X Pro', inches: 10.3, folder: 'InkPad_One_X_Pro', width: 1404, height: 1872, colour: false,
        source: 'https://liliputing.com/pocketbook-inkpad-one-is-a-10-3-inch-e-ink-writing-ablet/', verified: 'docs' },

    // For screens not listed: the common e-ink panels, named by their pixels. Colour is kept (most
    // newer panels are colour); "Force greyscale" serves the rest.
    ...([
        [13.3, 2400, 3200, undefined],
        [11, 1980, 2640, undefined],
        [10.7, 1920, 2560, 'Viwoods AiPaper'],
        [10.3, 1860, 2480, undefined],
        [10.3, 1404, 1872, 'Lenovo Smart Paper · Huawei MatePad Paper · Meebook M103'],
        [8, 1440, 1920, 'Viwoods AiPaper Mini'],
        [7, 1264, 1680, undefined],
    ] as const).map(([inches, width, height, also]): DeviceProfile => ({
        id: `generic_${width}x${height}`, platform: 'generic', name: `${width} × ${height} px`, also, inches,
        folder: `${width}x${height}`, width, height, colour: true, source: 'https://www.e-ink-info.com/', verified: 'docs',
    })),
];

/** Device ids an earlier version offered, and the options that now cover the same models. */
export const RENAMED_PROFILE_IDS: Readonly<Record<string, readonly string[]>> = {
    supernote_a5x_a6x_nomad: ['supernote_a5x', 'supernote_nomad'],
    boox_note_air3_nova_air: ['boox_note_air3', 'boox_nova_air'],
};

/** Kindle and Kobo cannot install note templates: their users write on the PDF, so it always ships. */
export const alwaysIncludesPdf = (profile: DeviceProfile): boolean => profile.platform === 'kindle' || profile.platform === 'kobo';
/** reMarkable has its own template routes and never gets the PDF. */
export const offersPdf = (profile: DeviceProfile): boolean => profile.platform !== 'remarkable';

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
