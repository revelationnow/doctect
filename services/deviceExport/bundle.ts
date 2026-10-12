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
interface ModelFolder { profile: DeviceProfile; root: string; nextName: (base: string) => string; pngCount: number; legacy: LegacyEntry[]; hasPdf: boolean }

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
        return [
            `reMarkable: ${profile.name}`,
            '',
            'reMarkable has no official way to add templates. Both routes below need SSH access',
            'or a tool such as RCU (https://www.davisr.me/projects/rcu/). Over USB the tablet is',
            'root@10.11.99.1; the password is in Settings > Help > Copyrights and licenses, under',
            'GPLv3 Compliance (software 3.9 to 3.18: Settings > Help > About > Copyrights and licenses).',
            '',
            `Option A: Methods templates (survive software updates${isRm2 ? '; needs software 3.17 or later' : ''})`,
            '1. Copy every file in methods/ to /home/root/.local/share/remarkable/xochitl/',
            '     scp methods/* root@10.11.99.1:/home/root/.local/share/remarkable/xochitl/',
            '2. Restart the interface:  ssh root@10.11.99.1 systemctl restart xochitl',
            '   Methods templates are line drawings. If anything had to be simplified,',
            '   CONVERSION-REPORT.txt at the top of this zip says what.',
            '',
            'Option B: PNG templates (exact look; every software update removes them)',
            ...numbered([
                // The rM2's root filesystem is writable; the Paper Pro and Paper Pro Move mount it read-only.
                ...(isRm2 ? [] : ['Make the system folder writable:  ssh root@10.11.99.1 mount -o remount,rw /']),
                'scp png/*.png root@10.11.99.1:/usr/share/remarkable/templates/',
                'Add the entries in png/templates.json to the "templates" list of\n   /usr/share/remarkable/templates/templates.json on the tablet.',
                'ssh root@10.11.99.1 systemctl restart xochitl',
            ]),
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
    const isBoox = profile.platform === 'boox';
    return [
        `${PLATFORM_LABELS[profile.platform]}: ${profile.name}`,
        '',
        isBoox ? '1. Connect the device by USB, or send the files with BOOXDrop.' : '1. Connect the device by USB.',
        '2. Copy the files in noteTemplate/ into Storage/noteTemplate/ on the device.',
        isBoox ? '3. In a note, tap the template icon and open the Local tab.' : '3. In a note, open the template picker and choose a page from the local templates.',
        ...(folder.hasPdf && isBoox ? ['', 'PDF templates work on the device but do not sync through BOOX cloud.'] : []),
        '',
    ].join('\n');
}

function readme(projectName: string, folders: ModelFolder[]): string {
    return [
        `Note templates exported from Doctect: ${projectName}`,
        '',
        'Each folder holds the templates for one device model, with an INSTALL.txt:',
        ...folders.map(folder => `  ${folder.root}/  (${folder.profile.width} x ${folder.profile.height} px)`),
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
            folder = { profile, root: `${PLATFORM_LABELS[profile.platform]}/${profile.folder}`, nextName: createNameAllocator(), pngCount: 0, legacy: [], hasPdf: false };
            folders.set(profile.id, folder);
        }
        return folder;
    };
    const templateDir = (folder: ModelFolder): string => {
        switch (folder.profile.platform) {
            case 'remarkable': return `${folder.root}/png`;
            case 'supernote': return `${folder.root}/MyStyle/${projectSlug}`;
            default: return `${folder.root}/noteTemplate`;
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
            const dir = `${folderFor(profile).root}/methods`;
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
            zip.file('README.txt', readme(projectName, [...folders.values()]));
            if (reportLines.length > 0) {
                zip.file('CONVERSION-REPORT.txt', ['Some pages were simplified or skipped:', '', ...reportLines.map(line => `- ${line}`), ''].join('\n'));
            }
            return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        },
    };
}
