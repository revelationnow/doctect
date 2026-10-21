// The zip handed to the user: one folder per device model, each with its templates and an
// INSTALL.txt, plus a README.txt and (only when something was simplified) CONVERSION-REPORT.txt.
// Layout follows docs/superpowers/specs/2026-10-12-device-template-export-design.md §6.

import JSZip from 'jszip';
import { PLATFORM_LABELS, type DeviceProfile } from './deviceProfiles';
import { createNameAllocator, slugify } from './fileNames';
import type { MethodsFiles } from './remarkableTemplate';

/** Icon of the stock "Blank" template in templates.json (device checklist item 1). */
export const LEGACY_ICON_CODE = '\ue9fe';

export interface DeviceZip {
    readonly fileName: string;
    addPng(profile: DeviceProfile, pageTitle: string, png: Blob, landscape: boolean): void;
    addMethods(profile: DeviceProfile, files: MethodsFiles): void;
    addPdf(profile: DeviceProfile, pdf: ArrayBuffer): void;
    report(line: string): void;
    finish(): Promise<Blob>;
}

/** One entry of the tablet's /usr/share/remarkable/templates/templates.json "templates" list. */
interface LegacyEntry { name: string; filename: string; iconCode: string; categories: string[]; landscape?: true }
interface ModelFolder { profile: DeviceProfile; root: string; nextName: (base: string) => string; pngCount: number; legacy: LegacyEntry[]; hasPdf: boolean; hasMethods: boolean }

const numbered = (steps: string[]): string[] => steps.map((step, i) => `${i + 1}. ${step}`);

/**
 * Pretty JSON with every non-ASCII UTF-16 unit written as a \\uXXXX escape (the stock file's own
 * form): the user merges this fragment by hand over SSH, and the icon glyph is an invisible
 * private-use character that a terminal paste can lose.
 */
const asciiJson = (value: unknown): string => JSON.stringify(value, null, 2).split('')
    .map(ch => (ch.charCodeAt(0) < 0x7f ? ch : '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))).join('');

function installGuide(folder: ModelFolder, projectSlug: string): string {
    const { profile } = folder;
    if (profile.platform === 'remarkable') {
        const isRm2 = profile.id === 'rm2';
        const tablet = 'root@10.11.99.1';
        const templates = '/usr/share/remarkable/templates';
        return [
            `reMarkable: ${profile.name}`,
            '',
            '!! READ THIS FIRST: INSTALLING IS AT YOUR OWN RISK !!',
            '',
            'reMarkable does not support adding your own templates. Both options below log in to the',
            'tablet as root over SSH and change its system files. Doctect cannot do this for you and',
            'cannot undo it for you.',
            '',
            '- A mistake can stop the tablet\'s interface from starting, or hide your other templates,',
            '  until it is put right over SSH or the tablet is factory reset.',
            ...(isRm2 ? [] : [
                '- On the Paper Pro and Paper Pro Move, SSH needs developer mode, and turning developer',
                '  mode on is a factory reset that erases the tablet. Sync your notebooks before you start.',
            ]),
            '- reMarkable support may not help with a tablet whose system files were changed.',
            '',
            'Only continue if you are comfortable using a terminal, SSH and scp, and know how to undo',
            'each step. If not, leave the tablet as it is.',
            '',
            'Connecting: use SSH, or a tool such as RCU (https://www.davisr.me/projects/rcu/). Over USB',
            `the tablet is ${tablet}; the password is in Settings > Help > Copyrights and licenses, under`,
            'GPLv3 Compliance (software 3.9 to 3.18: Settings > Help > About > Copyrights and licenses).',
            'The commands below are for a macOS or Linux terminal, run from the folder that holds this',
            'INSTALL.txt.',
            '',
            `Option A: Methods templates (survive software updates${isRm2 ? '; needs software 3.17 or later' : ''})`,
            // Every page of this model may have been skipped for Methods (shape or size cap, or a failed
            // conversion): then there is no methods/ folder, and the scp below would fail with "No such file".
            ...(folder.hasMethods ? [
                '1. Copy every file in methods/ to /home/root/.local/share/remarkable/xochitl/',
                `     scp methods/* ${tablet}:/home/root/.local/share/remarkable/xochitl/`,
                `2. Restart the interface:  ssh ${tablet} systemctl restart xochitl`,
                '   Methods templates are line drawings. If anything had to be simplified,',
                '   CONVERSION-REPORT.txt at the top of this zip says what.',
            ] : [
                '   This export has no Methods templates for this model: none of its pages could be',
                '   converted to a .template file. CONVERSION-REPORT.txt at the top of this zip says why.',
                '   Use Option B.',
            ]),
            '',
            'Option B: PNG templates (exact look; every software update removes them)',
            ...numbered([
                // The rM2's root filesystem is writable; the Paper Pro and Paper Pro Move mount it read-only.
                ...(isRm2 ? [] : [`Make the system folder writable:\n     ssh ${tablet} mount -o remount,rw /`]),
                `Copy the pictures:\n     scp png/*.png ${tablet}:${templates}/`,
                'Download the tablet\'s template list, and keep an untouched backup:\n'
                    + `     scp ${tablet}:${templates}/templates.json tablet-templates.json\n`
                    + '     cp tablet-templates.json tablet-templates.backup.json',
                'Add the entries in png/templates.json to that list. With jq (https://jqlang.org):\n'
                    + '     jq -a --slurpfile add png/templates.json \\\n'
                    + "       '($add[0].templates | map(.filename)) as $new\n"
                    + "        | .templates |= (map(select(.filename as $f | $new | index($f) | not)) + $add[0].templates)' \\\n"
                    + '       tablet-templates.json > merged.json\n'
                    + '   An entry with the same file name is replaced, so running this again is safe. The second\n'
                    + '   number this prints should be the first plus the number of new templates:\n'
                    + "     jq '.templates | length' tablet-templates.json merged.json\n"
                    + '   Without jq: copy tablet-templates.json to merged.json, open it in a text editor, and paste\n'
                    + '   the entries from png/templates.json into its "templates" list, with a comma between entries.',
                `Put the list back:\n     scp merged.json ${tablet}:${templates}/templates.json`,
                `Restart the interface:\n     ssh ${tablet} systemctl restart xochitl`,
                'In a notebook, open the Templates picker. The new pages are in the "Custom" category,\n'
                    + '   named after their page titles.',
            ]),
            '',
            'If the interface does not come back, or templates are missing, put the backup back and restart:',
            `     scp tablet-templates.backup.json ${tablet}:${templates}/templates.json`,
            `     ssh ${tablet} systemctl restart xochitl`,
            'A software update resets templates.json and removes the pictures: repeat Option B afterwards.',
            '',
        ].join('\n');
    }
    if (profile.platform === 'supernote') {
        return [
            `Supernote: ${profile.name}`,
            '',
            '1. Connect the Supernote by USB, or use Browse & Access, Supernote Partner or Supernote Cloud.',
            `2. Copy the folder MyStyle/${projectSlug}/ into Note/MyStyle/ on the device.`,
            '3. In a note, open Templates > Customization and pick a page.',
            ...(folder.hasPdf ? [
                '',
                `The PDF template (${projectSlug}.pdf) is picked the same way. Links between its pages work`,
                'when the linked pages are also applied as template pages. A PDF cannot be the default',
                'template for new notes.',
            ] : []),
            '',
        ].join('\n');
    }
    const heading = `${PLATFORM_LABELS[profile.platform]}: ${profile.name}${profile.also ? ` (also ${profile.also})` : ''}`;
    const pdf = `${projectSlug}.pdf`;
    if (profile.platform === 'kindle') {
        return [
            heading,
            '',
            'Kindle Scribe cannot install custom notebook templates. Write on the PDF instead:',
            '',
            `1. Send ${pdf} to your Kindle with Send to Kindle (amazon.com/sendtokindle, the Kindle app,`,
            '   or e-mail to your Send-to-Kindle address). Do not copy it over USB: you can only write on',
            '   documents that arrive through Send to Kindle.',
            '2. Open it on the Scribe and write on its pages with the pen.',
            '',
            'The PNG files can be sent the same way; each becomes a one-page document.',
            '',
        ].join('\n');
    }
    if (profile.platform === 'kobo') {
        return [
            heading,
            '',
            'Kobo cannot install custom notebook templates. Write on the PDF instead:',
            '',
            ...numbered([
                `Connect the Kobo by USB and copy ${pdf} onto it, or send it with the Dropbox or Google Drive link.`,
                'Open it from your library and write on its pages with the Kobo Stylus.',
            ]),
            '',
            'The PNG files are for other note apps; the Kobo notebook cannot use them as backgrounds.',
            '',
        ].join('\n');
    }
    if (profile.platform === 'pocketbook') {
        return [
            heading,
            '',
            ...numbered([
                'Connect the device by USB and copy the files in this folder onto it.',
                'Android models (InkPad Eo, Color Note, InkPad X Pro): in the Notes app, pick a PNG as the page background.',
                `InkPad One, or a Notes app without that choice: open ${folder.hasPdf ? pdf : 'a PNG'} and write on it with the stylus.`,
            ]),
            '',
            'PocketBook does not document custom templates, so the menus may differ on your firmware.',
            '',
        ].join('\n');
    }
    if (profile.platform === 'generic') {
        return [
            `Templates for ${profile.inches}" screens of ${profile.width} x ${profile.height} pixels${profile.also ? ` (e.g. ${profile.also})` : ''}.`,
            '',
            "Copy the PNG files to wherever your device's notes app takes custom templates or backgrounds.",
            ...(folder.hasPdf ? [`If it has none, open ${pdf} and write on its pages.`] : []),
            '',
        ].join('\n');
    }
    const isBoox = profile.platform === 'boox';
    return [
        heading,
        '',
        isBoox ? '1. Connect the device by USB, or send the files with BOOXDrop.' : '1. Connect the device by USB.',
        '2. Copy the files in noteTemplate/ into Storage/noteTemplate/ on the device.',
        isBoox ? '3. In a note, tap the template icon and open the Local tab.' : '3. In a note, open the template picker and choose a page from the local templates.',
        ...(folder.hasPdf && isBoox ? ['', 'PDF templates work on the device but do not sync through BOOX cloud.'] : []),
        ...(isBoox ? [] : ['', 'Bigme does not document custom templates; if the picker has no local templates, import a PNG from the Notes app.']),
        '',
    ].join('\n');
}

function readme(projectName: string, folders: ModelFolder[], hasReport: boolean): string {
    return [
        `Note templates exported from Doctect: ${projectName}`,
        '',
        'Each folder holds the templates for one device model, with an INSTALL.txt:',
        ...folders.map(folder => `  ${folder.root}/  (${folder.profile.width} x ${folder.profile.height} px)`),
        '',
        hasReport
            ? 'CONVERSION-REPORT.txt lists the pages that were simplified or skipped, and why.'
            : 'Nothing had to be simplified or skipped, so there is no CONVERSION-REPORT.txt.',
        '',
    ].join('\n');
}

export function createDeviceZip(projectName: string): DeviceZip {
    const zip = new JSZip();
    const projectSlug = slugify(projectName, 'project');
    const folders = new Map<string, ModelFolder>();
    const reportLines: string[] = [];

    const folderFor = (profile: DeviceProfile): ModelFolder => {
        let folder = folders.get(profile.id);
        if (!folder) {
            folder = { profile, root: `${PLATFORM_LABELS[profile.platform]}/${profile.folder}`, nextName: createNameAllocator(), pngCount: 0, legacy: [], hasPdf: false, hasMethods: false };
            folders.set(profile.id, folder);
        }
        return folder;
    };
    const templateDir = (folder: ModelFolder): string => {
        switch (folder.profile.platform) {
            case 'remarkable': return `${folder.root}/png`;
            case 'supernote': return `${folder.root}/MyStyle/${projectSlug}`;
            case 'boox': case 'bigme': return `${folder.root}/noteTemplate`;
            default: return folder.root;
        }
    };

    return {
        fileName: `${projectSlug}_device_templates.zip`,
        addPng(profile, pageTitle, png, landscape) {
            const folder = folderFor(profile);
            folder.pngCount += 1;
            const name = folder.nextName(slugify(pageTitle, `page-${folder.pngCount}`));
            // Bytes rather than the Blob: JSZip reads a Blob only through FileReader, which Node lacks.
            zip.file(`${templateDir(folder)}/${name}.png`, png.arrayBuffer(), { compression: 'STORE' });
            if (profile.platform === 'remarkable') {
                folder.legacy.push({ name: pageTitle, filename: name, iconCode: LEGACY_ICON_CODE, categories: ['Custom'], ...(landscape ? { landscape: true as const } : {}) });
            }
        },
        addMethods(profile, files) {
            const folder = folderFor(profile);
            folder.hasMethods = true;
            const dir = `${folder.root}/methods`;
            zip.file(`${dir}/${files.stem}.template`, files.template);
            zip.file(`${dir}/${files.stem}.metadata`, files.metadata);
            zip.file(`${dir}/${files.stem}.content`, files.content);
        },
        addPdf(profile, pdf) {
            const folder = folderFor(profile);
            folder.hasPdf = true;
            zip.file(`${templateDir(folder)}/${projectSlug}.pdf`, pdf, { compression: 'STORE' });
        },
        report(line) { reportLines.push(line); },
        async finish() {
            for (const folder of folders.values()) {
                if (folder.legacy.length > 0) zip.file(`${folder.root}/png/templates.json`, asciiJson({ templates: folder.legacy }));
                zip.file(`${folder.root}/INSTALL.txt`, installGuide(folder, projectSlug));
            }
            zip.file('README.txt', readme(projectName, [...folders.values()], reportLines.length > 0));
            if (reportLines.length > 0) {
                zip.file('CONVERSION-REPORT.txt', ['Some pages were simplified or skipped:', '', ...reportLines.map(line => `- ${line}`), ''].join('\n'));
            }
            return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        },
    };
}
