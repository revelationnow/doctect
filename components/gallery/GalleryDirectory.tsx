import React from 'react';
import { Square, GitFork, Download } from 'lucide-react';
import { GalleryItem, API_BASE } from '../../services/cloudApi';
import { GalleryLink } from './GalleryLink';
import { StarRating } from './StarRating';
import { cardFacts } from './ProjectCard';
import { categoryLabel } from '../../shared/galleryFacets.js';

// Dense list layout of one page of results. Ordering is the server's (the sort control),
// so this table never re-sorts — a client sort would only reorder the current page.
export function GalleryDirectory({ items }: { items: GalleryItem[] }) {
    return (
        <div className="overflow-x-auto bg-white border rounded-xl">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b text-left text-slate-600">
                        <th className="w-12" aria-hidden />
                        <th className="px-3 py-2 font-semibold">Name</th>
                        <th className="px-3 py-2 font-semibold">Author</th>
                        <th className="px-3 py-2 font-semibold">Category</th>
                        <th className="px-3 py-2 font-semibold">Size</th>
                        <th className="px-3 py-2 font-semibold">Rating</th>
                        <th className="px-3 py-2 font-semibold">Downloads</th>
                        <th className="px-3 py-2 font-semibold">Forks</th>
                        <th className="px-3 py-2 font-semibold">Updated</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map(i => (
                        <tr key={i.id} data-testid="directory-row" className="border-b last:border-b-0 hover:bg-slate-50">
                            <td className="pl-3 py-1.5">
                                {/* Bigger mouse target for the row's project link; aria-hidden +
                                    tabIndex=-1 keep the name link the row's only tab stop. */}
                                <GalleryLink projectId={i.id} tabIndex={-1} aria-hidden="true" className="block">
                                    <div className="w-8 aspect-[3/4] bg-slate-100 rounded overflow-hidden flex items-center justify-center">
                                        {i.thumbnailIds[0]
                                            ? <img src={`${API_BASE}/api/thumbnails/${i.thumbnailIds[0]}`} alt="" loading="lazy" className="w-full h-full object-cover" />
                                            : <Square size={12} className="text-slate-300" />}
                                    </div>
                                </GalleryLink>
                            </td>
                            <td className="px-3 py-1.5">
                                <GalleryLink projectId={i.id} className="font-medium text-slate-800 hover:text-blue-600">
                                    {i.name}
                                </GalleryLink>
                            </td>
                            <td className="px-3 py-1.5 text-slate-500">{i.author}</td>
                            <td className="px-3 py-1.5 text-slate-500">{i.category ? categoryLabel(i.category) : '—'}</td>
                            <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{cardFacts(i) || '—'}</td>
                            <td className="px-3 py-1.5">
                                {i.ratingCount > 0
                                    ? <StarRating value={i.ratingAvg} count={i.ratingCount} size={12} />
                                    : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-3 py-1.5 text-slate-500"><span className="flex items-center gap-1"><Download size={12} /> {i.downloadCount}</span></td>
                            <td className="px-3 py-1.5 text-slate-500"><span className="flex items-center gap-1"><GitFork size={12} /> {i.forkCount}</span></td>
                            <td className="px-3 py-1.5 text-slate-500">{i.updatedAt.slice(0, 10)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
