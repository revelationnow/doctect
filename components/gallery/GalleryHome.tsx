import React from 'react';
import { Link } from 'react-router-dom';
import { GalleryFacets, GalleryHome as GalleryHomeData, GalleryHomeTab, GalleryItem } from '../../services/cloudApi';
import { ProjectCard } from './ProjectCard';
import { GalleryExplainer } from './GalleryExplainer';
import { Spotlight } from './Spotlight';
import { galleryHref } from './galleryParams';

function Row({ title, emoji, href, count, items }: {
    title: string; emoji: string; href: string; count?: number; items: GalleryItem[];
}) {
    return (
        <section className="mt-8 first:mt-2">
            <div className="flex items-center justify-between mb-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <span aria-hidden>{emoji}</span> {title}
                    {count !== undefined && <span className="text-xs font-normal text-slate-400">({count})</span>}
                </h2>
                <Link to={href} className="text-xs text-blue-600 hover:underline">See all →</Link>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
                {items.map(i => <div key={i.id} className="w-44 shrink-0"><ProjectCard item={i} /></div>)}
            </div>
        </section>
    );
}

const TABS: { key: GalleryHomeTab; label: string }[] = [
    { key: 'planners', label: 'Planners & notebooks' },
    { key: 'templates', label: 'Templates' },
];

// Planners & notebooks | Templates. Counts come from the facets so they show before either
// tab's rows have loaded. Arrow keys move between tabs, as in any tablist.
function HomeTabs({ tab, facets, onChange }: {
    tab: GalleryHomeTab; facets: GalleryFacets | null; onChange: (tab: GalleryHomeTab) => void;
}) {
    const templates = facets?.categories.find(c => c.key === 'templates')?.count;
    const counts: Partial<Record<GalleryHomeTab, number>> = facets
        ? { planners: facets.total - (templates ?? 0), templates: templates ?? 0 }
        : {};
    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const next = TABS[(TABS.findIndex(t => t.key === tab) + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        onChange(next.key);
        document.getElementById(`gallery-tab-${next.key}`)?.focus();
    };
    return (
        <div role="tablist" aria-label="Gallery sections" className="flex gap-1 border-b mt-2 mb-4" onKeyDown={onKeyDown}>
            {TABS.map(t => {
                const selected = t.key === tab;
                return (
                    <button key={t.key} id={`gallery-tab-${t.key}`} role="tab" type="button"
                        aria-selected={selected} aria-controls="gallery-home-panel" tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(t.key)}
                        className={`px-3 py-2 -mb-px text-sm font-medium border-b-2 transition-colors ${selected
                            ? 'border-blue-600 text-blue-700'
                            : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                        {t.label}
                        {counts[t.key] !== undefined && <span className="ml-1 text-xs font-normal text-slate-400">({counts[t.key]})</span>}
                    </button>
                );
            })}
        </div>
    );
}

// The unfiltered landing: curated, bounded rows from GET /api/gallery/home, one set per tab.
// Every row's "See all" is just a results view with one filter or sort applied; on the
// templates tab that view is narrowed to the templates category.
export function GalleryHome({ home, facets, tab, onTabChange, placeholder }: {
    home: GalleryHomeData | null; facets: GalleryFacets | null;
    tab: GalleryHomeTab; onTabChange: (tab: GalleryHomeTab) => void; placeholder?: React.ReactNode;
}) {
    const countFor = (key: string) => facets?.categories.find(c => c.key === key)?.count;
    const category = tab === 'templates' ? 'templates' : undefined;
    const templatesCount = countFor('templates');
    return (
        <>
            <GalleryExplainer />
            <HomeTabs tab={tab} facets={facets} onChange={onTabChange} />
            <div id="gallery-home-panel" role="tabpanel" aria-labelledby={`gallery-tab-${tab}`}>
            {home === null ? placeholder : (<>
            {home.spotlight && <Spotlight item={home.spotlight} />}
            {home.trending.length > 0 && (
                <Row title="Trending" emoji="🔥" href={galleryHref({ category, sort: 'trending' })} items={home.trending} />
            )}
            {home.newest.length > 0 && (
                <Row title="New" emoji="🆕" href={galleryHref({ category, sort: 'recent' })} items={home.newest} />
            )}
            {home.categories.map(c => (
                <Row key={c.key} title={c.label} emoji={c.emoji} href={galleryHref({ category: c.key })}
                    count={countFor(c.key)} items={c.items} />
            ))}
            </>)}
            </div>
            {tab === 'templates' && templatesCount ? (
                <Link to={galleryHref({ category: 'templates', view: 'grid' })}
                    className="block w-full mt-10 border rounded-xl bg-white hover:border-blue-300 hover:text-blue-700 text-sm text-slate-700 font-medium py-3 text-center transition-colors">
                    Browse all {templatesCount} templates →
                </Link>
            ) : null}
            {tab === 'planners' && facets && facets.total > 0 && (
                <Link to={galleryHref({ view: 'grid' })}
                    className="block w-full mt-10 border rounded-xl bg-white hover:border-blue-300 hover:text-blue-700 text-sm text-slate-700 font-medium py-3 text-center transition-colors">
                    Browse all {facets.total} projects →
                </Link>
            )}
            {facets && facets.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t">
                    {facets.tags.map(t => (
                        <Link key={t.tag} to={galleryHref({ tag: t.tag })}
                            className="text-xs bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700 rounded-full px-3 py-1 transition-colors">
                            {t.label} <span className="text-slate-400">({t.count})</span>
                        </Link>
                    ))}
                </div>
            )}
        </>
    );
}
