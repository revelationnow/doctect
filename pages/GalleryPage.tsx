import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { cloudApi, GalleryFacets, GalleryHome as GalleryHomeData, GalleryHomeTab, GalleryItem, GallerySort } from '../services/cloudApi';
import { AppHeader } from '../components/AppHeader';
import { ProjectCard } from '../components/gallery/ProjectCard';
import { GalleryDirectory } from '../components/gallery/GalleryDirectory';
import { GalleryFilters } from '../components/gallery/GalleryFilters';
import { GalleryHome } from '../components/gallery/GalleryHome';
import { isBrowsing, readHomeTab, readParams, toQuery } from '../components/gallery/galleryParams';
import { categoryLabel, formatLabel } from '../shared/galleryFacets.js';

const PAGE_SIZE = 24;

function SkeletonGrid({ count }: { count: number }) {
    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: count }, (_, i) => (
                <div key={i} data-testid="skeleton-card" className="bg-white border rounded-xl overflow-hidden animate-pulse">
                    <div className="aspect-[3/4] bg-slate-100" />
                    <div className="p-3 space-y-2">
                        <div className="h-3.5 bg-slate-200 rounded w-3/4" />
                        <div className="h-3 bg-slate-200 rounded w-1/2" />
                    </div>
                </div>
            ))}
        </div>
    );
}

interface Results { items: GalleryItem[]; total: number; hasMore: boolean; sort: GallerySort; }

export function GalleryPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const params = readParams(searchParams);
    const browsing = isBrowsing(searchParams);
    const homeTab = readHomeTab(searchParams);
    // Stable key for the results fetch: the URL minus the layout toggle, which changes
    // how results look but not which results they are.
    const resultsKey = (() => {
        const sp = new URLSearchParams(searchParams);
        sp.delete('view');
        sp.sort();
        return sp.toString();
    })();

    const [qInput, setQInput] = useState(params.q);
    const [facets, setFacets] = useState<GalleryFacets | null>(null);
    // Each tab's landing is fetched once and kept, so switching back is instant.
    const [homes, setHomes] = useState<Partial<Record<GalleryHomeTab, GalleryHomeData>>>({});
    const home = homes[homeTab] ?? null;
    const [results, setResults] = useState<Results | null>(null);   // null = loading
    const [error, setError] = useState<string | null>(null);

    const setParam = (key: string, value: string | null) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            if (value) next.set(key, value); else next.delete(key);
            if (key !== 'page') next.delete('page');
            return next;
        });
    };
    const removeTag = (tag: string) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            const rest = next.getAll('tag').filter(t => t !== tag);
            next.delete('tag');
            rest.forEach(t => next.append('tag', t));
            next.delete('page');
            return next;
        });
    };
    const clearFilters = () => { setQInput(''); setSearchParams({}); };

    // Debounce the search box into ?q= so filtered views stay shareable/bookmarkable.
    useEffect(() => {
        const t = setTimeout(() => {
            if (qInput === params.q) return;
            setSearchParams(prev => {
                const next = new URLSearchParams(prev);
                if (qInput) next.set('q', qInput); else next.delete('q');
                next.delete('page');
                return next;
            }, { replace: true });
        }, 250);
        return () => clearTimeout(t);
    }, [qInput]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { setQInput(params.q); }, [params.q]);

    useEffect(() => {
        cloudApi.galleryFacets().then(setFacets).catch(() => {});
    }, []);

    useEffect(() => {
        if (browsing || home) return;
        cloudApi.galleryHome(homeTab)
            .then(h => { setHomes(prev => ({ ...prev, [homeTab]: h })); setError(null); })
            .catch(() => setError('Could not load the gallery.'));
    }, [browsing, homeTab]); // eslint-disable-line react-hooks/exhaustive-deps

    // The tab is landing state, not a filter: it stays on the landing and is left out of
    // isBrowsing, but lives in the URL so a tab can be linked to and Back returns to it.
    const selectHomeTab = (tab: GalleryHomeTab) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            if (tab === 'planners') next.delete('tab'); else next.set('tab', tab);
            return next;
        });
    };

    useEffect(() => {
        if (!browsing) return;
        let stale = false;
        setResults(null);
        cloudApi.gallery(toQuery(params))
            .then(res => { if (!stale) { setResults(res); setError(null); } })
            .catch(() => { if (!stale) setError('Could not load the gallery.'); });
        return () => { stale = true; };
    }, [browsing, resultsKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const chips: { label: string; onRemove: () => void }[] = [
        ...(params.q ? [{ label: `“${params.q}”`, onRemove: () => { setQInput(''); setParam('q', null); } }] : []),
        ...(params.category ? [{ label: categoryLabel(params.category), onRemove: () => setParam('category', null) }] : []),
        ...(params.format ? [{ label: formatLabel(params.format), onRemove: () => setParam('format', null) }] : []),
        ...params.tags.map(t => ({ label: `#${t}`, onRemove: () => removeTag(t) })),
        ...(params.minRating ? [{ label: `${params.minRating}★ and up`, onRemove: () => setParam('rating', null) }] : []),
    ];
    const activeSort: GallerySort = params.sort || results?.sort || (params.q ? 'relevance' : 'trending');
    const pageCount = results ? Math.max(1, Math.ceil(results.total / PAGE_SIZE)) : 1;
    const galleryEmpty = facets !== null && facets.total === 0;

    return (
        // h-screen + overflow-y-auto: index.html sets body{overflow:hidden}, so each page owns its scrolling
        <div className="h-screen overflow-y-auto bg-slate-50">
            <AppHeader />
            <div className="bg-white border-b px-4 sm:px-6 py-3 sticky top-14 z-10">
                <div className="max-w-6xl mx-auto flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
                    <div className="md:w-80 relative shrink-0">
                        <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                        <input value={qInput} onChange={e => setQInput(e.target.value)}
                            aria-label="Search the gallery"
                            placeholder="Search planners and notebooks…"
                            className="w-full border rounded-lg pl-8 pr-3 py-1.5 text-sm" />
                    </div>
                    <div className="flex-1">
                        <GalleryFilters params={params} facets={facets} activeSort={activeSort} onChange={setParam} />
                    </div>
                </div>
            </div>

            <main className="max-w-6xl mx-auto p-4 sm:p-6">
                {error && <div className="text-sm text-red-600">{error}</div>}

                {!browsing ? (
                    galleryEmpty
                        ? <div className="text-sm text-slate-400 text-center py-16">Nothing here yet. Publish the first project!</div>
                        : <GalleryHome home={home} facets={facets} tab={homeTab} onTabChange={selectHomeTab}
                            placeholder={!error && <SkeletonGrid count={8} />} />
                ) : (
                    <>
                        <div className="flex flex-wrap items-center gap-2 mb-4 min-h-7">
                            <span className="text-sm font-semibold text-slate-700" aria-live="polite">
                                {results === null ? 'Loading…' : `${results.total} ${results.total === 1 ? 'project' : 'projects'}`}
                            </span>
                            {chips.map(c => (
                                <span key={c.label} className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 rounded-full px-3 py-1">
                                    {c.label}
                                    <button onClick={c.onRemove} aria-label={`Remove filter ${c.label}`} className="hover:text-blue-900">
                                        <X size={12} />
                                    </button>
                                </span>
                            ))}
                            <button onClick={clearFilters} className="text-xs text-slate-500 hover:text-blue-600 ml-1">
                                {chips.length ? 'Clear all' : 'Back to gallery'}
                            </button>
                        </div>
                        {results === null ? (
                            !error && <SkeletonGrid count={8} />
                        ) : results.items.length === 0 ? (
                            <div className="text-center py-16">
                                <div className="text-sm text-slate-500">No projects match.</div>
                                {chips.length > 0 && (
                                    <div className="flex flex-wrap justify-center gap-2 mt-3">
                                        {chips.map(c => (
                                            <button key={c.label} onClick={c.onRemove} className="text-xs border rounded-full px-3 py-1 bg-white hover:border-blue-300 hover:text-blue-700">
                                                Remove {c.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <button onClick={clearFilters} className="text-xs text-blue-600 hover:underline mt-3">Clear filters</button>
                            </div>
                        ) : params.view === 'list' ? (
                            <GalleryDirectory items={results.items} />
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {results.items.map(item => <ProjectCard key={item.id} item={item} />)}
                            </div>
                        )}
                        {results && (params.page > 0 || results.hasMore) && (
                            <div className="flex justify-center items-center gap-3 mt-6 text-xs text-slate-500">
                                {params.page > 0 && <button onClick={() => setParam('page', String(params.page - 1))} className="px-3 py-1.5 border rounded bg-white">Previous</button>}
                                <span>Page {params.page + 1} of {pageCount}</span>
                                {results.hasMore && <button onClick={() => setParam('page', String(params.page + 1))} className="px-3 py-1.5 border rounded bg-white">Next</button>}
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}
