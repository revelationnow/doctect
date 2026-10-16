import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import type { GalleryItem } from '../../services/cloudApi';
import { openGalleryProjectInEditor } from '../../services/galleryOpen';
import { GalleryLink } from './GalleryLink';
import { RollingPreview } from './RollingPreview';
import { StarRating } from './StarRating';

export function Spotlight({ item }: { item: GalleryItem }) {
    const navigate = useNavigate();
    // One open per mount: a second activation before the route change commits would push a second /app entry
    // with its own target id. Navigating away unmounts this, so the flag never needs resetting.
    const opening = useRef(false);
    const openInEditor = () => {
        if (opening.current) return;
        opening.current = true;
        openGalleryProjectInEditor(navigate, item);
    };

    return (
        <section className="flex flex-col md:flex-row gap-6 bg-white border rounded-xl p-5 mb-8">
            <RollingPreview thumbnailIds={item.thumbnailIds} alt={item.name} autoPlay intervalMs={2000}
                className="md:w-72 aspect-[3/4] bg-slate-100 rounded-lg overflow-hidden shrink-0"
                imgClassName="w-full h-full object-contain" />
            <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-600 mb-1">
                    <Sparkles size={12} /> In the spotlight
                </div>
                <h2 className="text-xl font-bold text-slate-900 truncate">{item.name}</h2>
                <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                    by {item.author}
                    {item.ratingCount > 0 && <StarRating value={item.ratingAvg} count={item.ratingCount} size={12} />}
                </div>
                {item.description && <p className="text-sm text-slate-600 mt-3 line-clamp-4">{item.description}</p>}
                <div className="flex items-center gap-3 mt-auto pt-4">
                    <button onClick={openInEditor}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2">
                        Open in editor
                    </button>
                    <GalleryLink projectId={item.id} className="text-sm text-blue-600 hover:underline">
                        See details
                    </GalleryLink>
                </div>
            </div>
        </section>
    );
}
