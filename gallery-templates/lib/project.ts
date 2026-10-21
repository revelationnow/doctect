import type { AppState } from '../../types';
import { createGeneratedAppState } from '../../services/generatedProjectState';
import { createBlankProject } from '../../services/presets';
import { validateGeneratedProject } from '../../services/validateGeneratedProject';
import { DEVICES, Page, type Device } from './page';

export const TEMPLATE_ID = 'page';
export const ROOT_ID = 'root';

export interface Listing {
    name: string;
    description: string;
    tags: string[];
}

export interface TemplateDefinition {
    slug: string;
    listing: Listing;
    draw(page: Page): void;
}

export const drawPage = (definition: TemplateDefinition, device: Device) => {
    const page = new Page(device);
    definition.draw(page);
    return page;
};

// The same raw shape the in-app generator produces: every variant carries the one template,
// and the hierarchy is a single node.
export const buildRawProject = (definition: TemplateDefinition) => {
    const variants = Object.fromEntries(DEVICES.map(device => [device.id, {
        id: device.id,
        name: device.name,
        templates: {
            [TEMPLATE_ID]: {
                id: TEMPLATE_ID,
                name: definition.listing.name,
                width: device.width,
                height: device.height,
                elements: drawPage(definition, device).elements,
            },
        },
    }]));
    return {
        templates: { variants, activeVariantId: DEVICES[0].id },
        hierarchy: {
            rootId: ROOT_ID,
            nodes: {
                [ROOT_ID]: { id: ROOT_ID, parentId: null, type: TEMPLATE_ID, title: definition.listing.name, data: {}, children: [] },
            },
        },
    };
};

// Runs the raw project through the app's own validation and state construction, exactly as the
// Hierarchy Generator does, then drops the generator source: these pages are not made by a
// pasteable script.
export const buildProjectState = (definition: TemplateDefinition): AppState => {
    const validation = validateGeneratedProject(buildRawProject(definition));
    if (validation.ok === false) throw new Error(`${definition.slug}: ${validation.message}`);
    const state = createGeneratedAppState(createBlankProject(), validation.project,
        { formatVersion: 1, templateScript: '', hierarchyScript: '' }, new Date(0).toISOString());
    delete state.generator;
    return state;
};
