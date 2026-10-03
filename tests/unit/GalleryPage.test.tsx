import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { GalleryPage } from '../../pages/GalleryPage';
import { cloudApi, GalleryFacets, GalleryHome, GalleryItem } from '../../services/cloudApi';

const mockUseSession = vi.fn();
vi.mock('../../lib/auth-client', () => ({
    useSession: () => mockUseSession(),
    signOut: vi.fn(),
}));

const mkItem = (id: string, name: string, over: Partial<GalleryItem> = {}): GalleryItem => ({
    id, name, description: 'desc', tags: ['planner'], author: 'maker',
    forkCount: 0, downloadCount: 0, updatedAt: '2026-01-01', thumbnailId: null,
    thumbnailIds: [],
    ratingAvg: 4.0, ratingCount: 2,
    category: 'planners', formats: ['a5'], pageCount: 12,
    ...over,
});

const home: GalleryHome = {
    spotlight: mkItem('s1', 'Spot Pick'),
    trending: [mkItem('t1', 'Hot One'), mkItem('t2', 'Hot Two')],
    newest: [mkItem('n1', 'Fresh One')],
    categories: [{ key: 'games', label: 'Games & play', emoji: '🎲', items: [mkItem('g1', 'Dice Den', { category: 'games' })] }],
};

const facets: GalleryFacets = {
    total: 5,
    categories: [{ key: 'planners', label: 'Planners', count: 4 }, { key: 'games', label: 'Games & play', count: 1 }],
    formats: [{ key: 'a5', label: 'A5', count: 3 }],
    tags: [{ tag: 'planner', label: 'planners', count: 3 }, { tag: 'weekly', label: 'weekly', count: 1 }],
};

let lastSearch = '';
function LocationProbe() {
    lastSearch = useLocation().search;
    return null;
}

const renderAt = (entry = '/gallery') => render(
    <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <Routes>
            <Route path="/gallery" element={<GalleryPage />} />
            <Route path="/gallery/:id" element={<div>DETAIL_MARKER</div>} />
        </Routes>
    </MemoryRouter>
);

describe('GalleryPage', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        // GalleryExplainer's dismissal flag persists in jsdom localStorage across tests.
        localStorage.clear();
        mockUseSession.mockReturnValue({ data: null });
        vi.spyOn(cloudApi, 'galleryFacets').mockResolvedValue(facets);
        vi.spyOn(cloudApi, 'galleryHome').mockResolvedValue(home);
        vi.spyOn(cloudApi, 'gallery').mockResolvedValue({ items: [mkItem('p1', 'Alpha')], page: 0, hasMore: false, total: 1, sort: 'trending' });
    });

    describe('landing', () => {
        it('shows explainer, spotlight, trending/new rows, category rows and tag chips — never the full catalog', async () => {
            renderAt();
            expect(await screen.findByText(/make it yours/i)).toBeInTheDocument();
            expect(screen.getByText(/in the spotlight/i)).toBeInTheDocument();
            expect(screen.getByRole('heading', { name: /trending/i })).toBeInTheDocument();
            expect(screen.getByRole('heading', { name: /^new$/i })).toBeInTheDocument();
            const games = screen.getByRole('heading', { name: /games & play/i }).closest('section') as HTMLElement;
            expect(within(games).getByText('Dice Den')).toBeInTheDocument();
            expect(within(games).getByText('(1)')).toBeInTheDocument();
            expect(within(games).getByRole('link', { name: /see all/i })).toHaveAttribute('href', '/gallery?category=games');
            expect(screen.getByRole('link', { name: /planners \(3\)/i })).toHaveAttribute('href', '/gallery?tag=planner');
            expect(screen.getByRole('link', { name: /browse all 5 projects/i })).toHaveAttribute('href', '/gallery?view=grid');
            expect(cloudApi.gallery).not.toHaveBeenCalled();
        });

        it('shows the empty state for an empty catalog', async () => {
            vi.spyOn(cloudApi, 'galleryFacets').mockResolvedValue({ total: 0, categories: [], formats: [], tags: [] });
            vi.spyOn(cloudApi, 'galleryHome').mockResolvedValue({ spotlight: null, trending: [], newest: [], categories: [] });
            renderAt();
            expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument();
        });

        it('shows the error message when the landing fails to load', async () => {
            vi.spyOn(cloudApi, 'galleryHome').mockRejectedValue(new Error('down'));
            renderAt();
            expect(await screen.findByText(/could not load the gallery/i)).toBeInTheDocument();
        });

        it('the same filter controls are on the landing; using one opens results', async () => {
            renderAt();
            await screen.findByText(/in the spotlight/i);
            fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'games' } });
            await waitFor(() => expect(cloudApi.gallery).toHaveBeenCalledWith(expect.objectContaining({ category: 'games' })));
            expect(screen.queryByText(/in the spotlight/i)).toBeNull();
        });

        it('typing a search opens results with the q param', async () => {
            renderAt();
            await screen.findByText(/in the spotlight/i);
            fireEvent.change(screen.getByPlaceholderText(/search planners/i), { target: { value: 'alp' } });
            await waitFor(() => expect(cloudApi.gallery).toHaveBeenCalledWith(expect.objectContaining({ q: 'alp' })), { timeout: 2000 });
        });
    });

    describe('results', () => {
        it('reads every filter from the URL, including repeated tags', async () => {
            renderAt('/gallery?q=wk&tag=planner&tag=weekly&category=planners&format=a5&rating=4&sort=rating&page=1');
            await waitFor(() => expect(cloudApi.gallery).toHaveBeenCalledWith({
                q: 'wk', tags: ['planner', 'weekly'], category: 'planners', format: 'a5', minRating: 4, sort: 'rating', page: 1,
            }));
        });

        it('shows the match count and a removable chip per active filter', async () => {
            vi.spyOn(cloudApi, 'gallery').mockResolvedValue({ items: [mkItem('p1', 'Alpha')], page: 0, hasMore: false, total: 1, sort: 'trending' });
            renderAt('/gallery?tag=planner&tag=weekly&format=a5');
            expect(await screen.findByText('1 project')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Remove filter #weekly' }));
            await waitFor(() => expect(new URLSearchParams(lastSearch).getAll('tag')).toEqual(['planner']));
            expect(new URLSearchParams(lastSearch).get('format')).toBe('a5');
            fireEvent.click(screen.getByRole('button', { name: 'Remove filter A5' }));
            await waitFor(() => expect(lastSearch).toBe('?tag=planner'));
        });

        it('Clear all returns to the landing', async () => {
            renderAt('/gallery?tag=planner');
            await screen.findByText('Alpha');
            fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
            expect(await screen.findByText(/in the spotlight/i)).toBeInTheDocument();
        });

        it('the sort select reflects what the server applied and offers Best match only when searching', async () => {
            vi.spyOn(cloudApi, 'gallery').mockResolvedValue({ items: [mkItem('p1', 'Alpha')], page: 0, hasMore: false, total: 1, sort: 'relevance' });
            renderAt('/gallery?q=x');
            await screen.findByText('Alpha');
            const select = screen.getByRole('combobox', { name: 'Sort' }) as HTMLSelectElement;
            expect(select.value).toBe('relevance');
            fireEvent.change(select, { target: { value: 'rating' } });
            await waitFor(() => expect(cloudApi.gallery).toHaveBeenCalledWith(expect.objectContaining({ sort: 'rating' })));

            fireEvent.change(screen.getByPlaceholderText(/search planners/i), { target: { value: '' } });
            await waitFor(() => expect(screen.queryByRole('option', { name: /best match/i })).toBeNull(), { timeout: 2000 });
        });

        it('the 4+ toggle filters by minimum rating', async () => {
            renderAt('/gallery?view=grid');
            await screen.findByText('Alpha');
            fireEvent.click(screen.getByRole('button', { name: /4\+/ }));
            await waitFor(() => expect(cloudApi.gallery).toHaveBeenCalledWith(expect.objectContaining({ minRating: 4 })));
        });

        it('the layout toggle switches to a list without refetching; view=all reads as list', async () => {
            renderAt('/gallery?view=grid');
            await screen.findByText('Alpha');
            expect(cloudApi.gallery).toHaveBeenCalledTimes(1);
            fireEvent.click(screen.getByRole('button', { name: 'List view' }));
            expect(await screen.findAllByTestId('directory-row')).toHaveLength(1);
            expect(cloudApi.gallery).toHaveBeenCalledTimes(1);

            renderAt('/gallery?view=all');
            expect(await screen.findAllByTestId('directory-row')).not.toHaveLength(0);
        });

        it('offers to remove each filter when nothing matches', async () => {
            vi.spyOn(cloudApi, 'gallery').mockResolvedValue({ items: [], page: 0, hasMore: false, total: 0, sort: 'trending' });
            renderAt('/gallery?category=games&format=a5');
            expect(await screen.findByText(/no projects match/i)).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Remove A5' }));
            await waitFor(() => expect(lastSearch).toBe('?category=games'));
        });

        it('pages with Previous/Next and shows the page count', async () => {
            vi.spyOn(cloudApi, 'gallery').mockResolvedValue({ items: [mkItem('p1', 'Alpha')], page: 1, hasMore: true, total: 60, sort: 'trending' });
            renderAt('/gallery?sort=trending&page=1');
            expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Next' }));
            await waitFor(() => expect(lastSearch).toBe('?sort=trending&page=2'));
        });
    });
});
