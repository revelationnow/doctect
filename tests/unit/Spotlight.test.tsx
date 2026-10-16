import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Spotlight } from '../../components/gallery/Spotlight';
import { cloudApi, GalleryItem } from '../../services/cloudApi';
import * as importProject from '../../services/importProject';

vi.mock('../../services/importProject', () => ({
    IMPORT_STAGE_ERROR_MESSAGE: 'Could not prepare this project for the editor. Nothing was removed; try again.',
    stageImport: vi.fn(),
}));

const item: GalleryItem = {
    id: 'p1', name: 'Novel Story Studio', description: 'Plot and draft a novel.', tags: ['writing'],
    author: 'doctect', forkCount: 0, downloadCount: 5, updatedAt: '2026-01-01',
    thumbnailId: 't1', thumbnailIds: ['t1', 't2'], ratingAvg: 5, ratingCount: 3,
    category: null, formats: [], pageCount: null,
};

// Echoes the history state so a test can assert the request the gallery handed /app.
const EchoState = () => <div>EDITOR_MARKER {JSON.stringify(useLocation().state)}</div>;

const renderIt = () => render(
    <MemoryRouter initialEntries={['/gallery']}>
        <Routes>
            <Route path="/gallery" element={<Spotlight item={item} />} />
            <Route path="/gallery/:id" element={<div>DETAIL_MARKER</div>} />
            <Route path="/app" element={<EchoState />} />
        </Routes>
    </MemoryRouter>);

beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(importProject.stageImport).mockReset();
});

describe('Spotlight', () => {
    it('renders name, author, description and rating', () => {
        renderIt();
        expect(screen.getByText('Novel Story Studio')).toBeInTheDocument();
        expect(screen.getByText(/doctect/)).toBeInTheDocument();
        expect(screen.getByText(/plot and draft a novel/i)).toBeInTheDocument();
    });

    it('"Open in editor" navigates to /app at once with a gallery request and does not stage', async () => {
        const galleryState = vi.spyOn(cloudApi, 'galleryState').mockResolvedValue({ name: 'Novel Story Studio', state: { nodes: [] } });
        renderIt();
        fireEvent.click(screen.getByRole('button', { name: /open in editor/i }));
        const editor = await screen.findByText(/EDITOR_MARKER/);
        expect(editor).toHaveTextContent('"galleryId":"p1"');
        expect(editor).toHaveTextContent('"name":"Novel Story Studio"');
        expect(galleryState).not.toHaveBeenCalled();
        expect(importProject.stageImport).not.toHaveBeenCalled();
    });

    it('"See details" links to the project', () => {
        renderIt();
        fireEvent.click(screen.getByRole('link', { name: /see details/i }));
        expect(screen.getByText('DETAIL_MARKER')).toBeInTheDocument();
    });
});
