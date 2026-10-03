import { GalleryQuery, GallerySort } from '../../services/cloudApi';

// The gallery's whole state lives in the URL so every view is a shareable link.
// Params: q, tag (repeatable, ANDed), category, format, rating (minimum stars), sort,
// view (grid | list; the older `view=all` reads as list), page.
export type GalleryView = 'grid' | 'list';

export interface GalleryParams {
    q: string;
    tags: string[];
    category: string;
    format: string;
    minRating: number;
    sort: GallerySort | '';
    view: GalleryView;
    page: number;
}

const SORTS: GallerySort[] = ['relevance', 'trending', 'recent', 'rating', 'popular'];
const BROWSE_KEYS = ['q', 'tag', 'category', 'format', 'rating', 'sort', 'view'];

export function readParams(sp: URLSearchParams): GalleryParams {
    const sort = sp.get('sort') ?? '';
    return {
        q: sp.get('q') ?? '',
        tags: [...new Set(sp.getAll('tag').filter(Boolean))],
        category: sp.get('category') ?? '',
        format: sp.get('format') ?? '',
        minRating: Math.min(5, Math.max(0, parseInt(sp.get('rating') ?? '0', 10) || 0)),
        sort: (SORTS as string[]).includes(sort) ? sort as GallerySort : '',
        view: sp.get('view') === 'list' || sp.get('view') === 'all' ? 'list' : 'grid',
        page: Math.max(0, parseInt(sp.get('page') ?? '0', 10) || 0),
    };
}

// Any browse param leaves the curated landing for the results grid.
export const isBrowsing = (sp: URLSearchParams) => BROWSE_KEYS.some(k => sp.has(k));

export const toQuery = (p: GalleryParams): GalleryQuery => ({
    q: p.q || undefined,
    tags: p.tags.length ? p.tags : undefined,
    category: p.category || undefined,
    format: p.format || undefined,
    minRating: p.minRating || undefined,
    sort: p.sort || undefined,
    page: p.page || undefined,
});

// Link to a results view with exactly these filters (used by "See all", chips and tags).
export function galleryHref(filters: { tag?: string; category?: string; format?: string; sort?: GallerySort; view?: GalleryView }) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) sp.set(k, v);
    const qs = sp.toString();
    return qs ? `/gallery?${qs}` : '/gallery';
}
