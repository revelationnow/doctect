import React from 'react';
import { LayoutGrid, List, Star } from 'lucide-react';
import { GalleryFacets, GallerySort } from '../../services/cloudApi';
import { GalleryParams, GalleryView } from './galleryParams';

const SORT_LABELS: Record<GallerySort, string> = {
    relevance: 'Best match',
    trending: 'Trending',
    recent: 'Newest',
    rating: 'Top rated',
    popular: 'Most downloaded',
};

const selectClass = 'border rounded-lg px-2 py-1.5 text-sm bg-white max-w-[12rem]';

// One control row for every gallery view, so filtering and sorting work the same on the
// landing and in results. `activeSort` is what the server actually applied (it picks
// relevance when searching, trending otherwise) so the select never shows a stale default.
export function GalleryFilters({ params, facets, activeSort, onChange }: {
    params: GalleryParams;
    facets: GalleryFacets | null;
    activeSort: GallerySort;
    onChange: (key: string, value: string | null) => void;
}) {
    const sorts = (Object.keys(SORT_LABELS) as GallerySort[]).filter(s => s !== 'relevance' || params.q);
    const setView = (view: GalleryView) => onChange('view', view);
    return (
        <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Category" value={params.category} onChange={e => onChange('category', e.target.value || null)} className={selectClass}>
                <option value="">All categories</option>
                {facets?.categories.map(c => <option key={c.key} value={c.key}>{c.label} ({c.count})</option>)}
                {/* Keep a filter from a shared link selectable even if its count is now zero. */}
                {params.category && !facets?.categories.some(c => c.key === params.category) && (
                    <option value={params.category}>{params.category}</option>
                )}
            </select>
            <select aria-label="Page size or device" value={params.format} onChange={e => onChange('format', e.target.value || null)} className={selectClass}>
                <option value="">Any size or device</option>
                {facets?.formats.map(f => <option key={f.key} value={f.key}>{f.label} ({f.count})</option>)}
                {params.format && !facets?.formats.some(f => f.key === params.format) && (
                    <option value={params.format}>{params.format}</option>
                )}
            </select>
            <button type="button" aria-pressed={params.minRating >= 4}
                onClick={() => onChange('rating', params.minRating >= 4 ? null : '4')}
                className={`flex items-center gap-1 border rounded-lg px-2 py-1.5 text-sm ${params.minRating >= 4 ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white text-slate-600'}`}>
                <Star size={12} /> 4+
            </button>
            <select aria-label="Sort" value={activeSort} onChange={e => onChange('sort', e.target.value)} className={selectClass}>
                {sorts.map(s => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
            </select>
            <div className="flex border rounded-lg overflow-hidden ml-auto" role="group" aria-label="Layout">
                <button type="button" aria-label="Grid view" aria-pressed={params.view === 'grid'} onClick={() => setView('grid')}
                    className={`px-2 py-1.5 ${params.view === 'grid' ? 'bg-slate-100 text-slate-800' : 'bg-white text-slate-400'}`}>
                    <LayoutGrid size={14} />
                </button>
                <button type="button" aria-label="List view" aria-pressed={params.view === 'list'} onClick={() => setView('list')}
                    className={`px-2 py-1.5 ${params.view === 'list' ? 'bg-slate-100 text-slate-800' : 'bg-white text-slate-400'}`}>
                    <List size={14} />
                </button>
            </div>
        </div>
    );
}
