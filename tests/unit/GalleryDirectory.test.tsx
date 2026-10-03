import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GalleryDirectory } from '../../components/gallery/GalleryDirectory';
import { GalleryItem } from '../../services/cloudApi';

const item = (over: Partial<GalleryItem>): GalleryItem => ({
    id: 'x', name: 'X', description: '', tags: [], author: 'a',
    forkCount: 0, downloadCount: 0, updatedAt: '2026-08-01 10:00:00',
    thumbnailId: null, thumbnailIds: [], ratingAvg: null, ratingCount: 0,
    category: null, formats: [], pageCount: null,
    ...over,
});

const items = [
    item({ id: 'p1', name: 'Beta', author: 'zoe', category: 'planners', formats: ['a5', 'custom'], pageCount: 12, downloadCount: 5, updatedAt: '2026-08-03 10:00:00', ratingAvg: 3.5, ratingCount: 2, thumbnailIds: ['t1'], thumbnailId: 't1' }),
    item({ id: 'p2', name: 'Alpha', author: 'amy', downloadCount: 9, updatedAt: '2026-08-01 10:00:00', ratingAvg: null, ratingCount: 0 }),
    item({ id: 'p3', name: 'Gamma', author: 'mel', downloadCount: 1, updatedAt: '2026-08-05 10:00:00', ratingAvg: 5, ratingCount: 1 }),
];

const renderIt = () => render(
    <MemoryRouter initialEntries={['/gallery?view=all']}>
        <Routes>
            <Route path="/gallery" element={<GalleryDirectory items={items} />} />
            <Route path="/gallery/:id" element={<div>DETAIL_MARKER</div>} />
        </Routes>
    </MemoryRouter>);

const rowNames = () => screen.getAllByTestId('directory-row').map(r => within(r).getByRole('link').textContent);

describe('GalleryDirectory', () => {
    it('renders one row per item in the order given (the server sorted them)', () => {
        renderIt();
        expect(rowNames()).toEqual(['Beta', 'Alpha', 'Gamma']);
        // No client-side sort controls: re-sorting one page would misrepresent the whole set.
        expect(screen.queryByRole('button', { name: /^name$/i })).toBeNull();
    });

    it('shows author, category, size, downloads and sliced date per row', () => {
        renderIt();
        const beta = screen.getAllByTestId('directory-row')[0];
        expect(within(beta).getByText('zoe')).toBeInTheDocument();
        expect(within(beta).getByText('Planners')).toBeInTheDocument();
        expect(within(beta).getByText('A5 · 12 pages')).toBeInTheDocument();
        expect(within(beta).getByText('2026-08-03')).toBeInTheDocument();
    });

    it('row name links to the project detail', () => {
        renderIt();
        fireEvent.click(within(screen.getAllByTestId('directory-row')[0]).getByRole('link'));
        expect(screen.getByText('DETAIL_MARKER')).toBeInTheDocument();
    });

    it('thumbnail cell links to the project without adding a second tab stop', () => {
        renderIt();
        const row = screen.getAllByTestId('directory-row')[0];
        // exactly one link in the accessibility tree per row: the thumb link is aria-hidden
        expect(within(row).getAllByRole('link')).toHaveLength(1);
        const links = within(row).getAllByRole('link', { hidden: true });
        expect(links).toHaveLength(2);
        const thumbLink = links[0]; // thumbnail cell comes first in DOM order
        expect(thumbLink).toHaveAttribute('aria-hidden', 'true');
        expect(thumbLink).toHaveAttribute('tabindex', '-1');
        fireEvent.click(thumbLink);
        expect(screen.getByText('DETAIL_MARKER')).toBeInTheDocument();
    });
});
