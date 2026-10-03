import React from 'react';
import { Link } from 'react-router-dom';
import { GalleryFacets, GalleryHome as GalleryHomeData, GalleryItem } from '../../services/cloudApi';
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

// The unfiltered landing: curated, bounded rows from GET /api/gallery/home. Every row's
// "See all" is just a results view with one filter or sort applied.
export function GalleryHome({ home, facets }: { home: GalleryHomeData; facets: GalleryFacets | null }) {
    const countFor = (key: string) => facets?.categories.find(c => c.key === key)?.count;
    return (
        <>
            <GalleryExplainer />
            {home.spotlight && <Spotlight item={home.spotlight} />}
            {home.trending.length > 0 && (
                <Row title="Trending" emoji="🔥" href={galleryHref({ sort: 'trending' })} items={home.trending} />
            )}
            {home.newest.length > 0 && (
                <Row title="New" emoji="🆕" href={galleryHref({ sort: 'recent' })} items={home.newest} />
            )}
            {home.categories.map(c => (
                <Row key={c.key} title={c.label} emoji={c.emoji} href={galleryHref({ category: c.key })}
                    count={countFor(c.key)} items={c.items} />
            ))}
            {facets && facets.total > 0 && (
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
