import { describe, expect, it } from 'vitest';
import { listPreviewNodes } from '../../services/previewNodes';

const base: any = {
    viewMode: 'templates', selectedTemplateId: 'day',
    nodes: {
        root: { id: 'root', type: 'cover', title: 'Cover' },
        d1: { id: 'd1', type: 'day', title: 'Mon' },
        d2: { id: 'd2', type: 'day', title: 'Tue' },
    },
};

describe('listPreviewNodes', () => {
    it('lists nodes using the selected template in templates view', () => {
        expect(listPreviewNodes(base, 'd2')).toEqual({
            options: [{ id: 'd1', title: 'Mon' }, { id: 'd2', title: 'Tue' }], selectedId: 'd2',
        });
    });
    it('returns null outside templates view or with no matching nodes', () => {
        expect(listPreviewNodes({ ...base, viewMode: 'hierarchy' }, 'root')).toBeNull();
        expect(listPreviewNodes({ ...base, selectedTemplateId: 'none' }, 'root')).toBeNull();
    });
});
