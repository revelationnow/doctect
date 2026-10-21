// Template listings in the gallery offer "Download as template": the editor's Export as template
// dialog, opened on the published project, with its variants to choose from.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GalleryDetailPage } from '../../pages/GalleryDetailPage';
import { cloudApi, GalleryDetail } from '../../services/cloudApi';

vi.mock('../../lib/auth-client', () => ({ useSession: () => ({ data: null }) }));

const listing = (category: string | null): GalleryDetail => ({
    id: 'tpl-1', name: 'Cornell Notes', description: 'd', tags: [], author: 'doctect',
    forkCount: 0, downloadCount: 0, updatedAt: '2026-10-20', ownerId: 'owner-1',
    headCommitId: 'c1', thumbnailIds: [], previews: [], forkedFrom: null,
    ratingAvg: null, ratingCount: 0, category, formats: [], pageCount: 1,
});

const page = (width: number, height: number) => ({ page: { id: 'page', name: 'Page', width, height, layers: [], elements: [] } });
const templateState = {
    nodes: { root: { id: 'root', parentId: null, type: 'page', title: 'Cornell Notes', data: {}, children: [] } },
    rootId: 'root',
    variants: {
        paper_pro: { id: 'paper_pro', name: 'reMarkable Paper Pro', templates: page(509, 679) },
        move: { id: 'move', name: 'reMarkable Paper Pro Move', templates: page(260, 463) },
    },
    activeVariantId: 'paper_pro',
    schemaVersion: 12,
};

const renderAt = () => render(
    <MemoryRouter initialEntries={['/gallery/tpl-1']}>
        <Routes><Route path="/gallery/:id" element={<GalleryDetailPage />} /></Routes>
    </MemoryRouter>,
);

describe('Download as template', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(cloudApi, 'listReviews').mockResolvedValue({ reviews: [], myReview: null } as never);
    });

    it('opens the template export on a template listing, with its variants and pages', async () => {
        vi.spyOn(cloudApi, 'galleryDetail').mockResolvedValue(listing('templates'));
        const fetchState = vi.spyOn(cloudApi, 'galleryState').mockResolvedValue({ name: 'Cornell Notes', state: templateState });
        renderAt();
        fireEvent.click(await screen.findByRole('button', { name: /Download as template/ }));
        const dialog = await screen.findByRole('dialog', { name: 'Export as template' });
        expect(fetchState).toHaveBeenCalledWith('tpl-1');
        const variant = within(dialog).getByRole('combobox', { name: 'Variant' }) as HTMLSelectElement;
        expect(variant.value).toBe('paper_pro');
        expect([...variant.options].map(o => o.textContent)).toEqual(['reMarkable Paper Pro', 'reMarkable Paper Pro Move']);
        expect((within(dialog).getByRole('checkbox', { name: 'Cornell Notes' }) as HTMLInputElement).checked).toBe(true);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog', { name: 'Export as template' })).toBeNull();
    });

    it('is not offered on other listings', async () => {
        vi.spyOn(cloudApi, 'galleryDetail').mockResolvedValue(listing('planners'));
        renderAt();
        expect(await screen.findByRole('button', { name: /Download all variants/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Download as template/ })).toBeNull();
    });

    it('says so when the project cannot be loaded, and opens nothing', async () => {
        vi.spyOn(cloudApi, 'galleryDetail').mockResolvedValue(listing('templates'));
        vi.spyOn(cloudApi, 'galleryState').mockRejectedValue(new Error('offline'));
        renderAt();
        fireEvent.click(await screen.findByRole('button', { name: /Download as template/ }));
        expect(await screen.findByText('Could not load the template for download')).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Export as template' })).toBeNull();
    });
});
