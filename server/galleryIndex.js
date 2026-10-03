import { dbType, query, withTransaction } from './db.js';
import { decodeStateRow } from './stateCodec.js';
import { INDEX_VERSION, deriveFacets, normalizeTag } from '../shared/galleryFacets.js';

// Maintains the gallery's derived side tables (migration 018) for one project. Reads the
// published snapshot and published_* columns only — it never writes to projects or commits,
// so indexing is safe to re-run at any time and needs nothing from the project's author.
// Call inside the transaction that changed what is published (publish, listing edit).
export async function reindexProject(projectId, txQuery) {
    const rows = await txQuery(
        `SELECT id, visibility, published_commit_id, published_name, published_description, published_tags
         FROM projects WHERE id = $1`, [projectId]);
    const p = rows[0];
    if (!p || p.visibility !== 'public' || !p.published_commit_id) {
        await deleteGalleryIndex(projectId, txQuery, { keepStats: true });
        return;
    }

    let tags = [];
    try { tags = JSON.parse(p.published_tags || '[]'); } catch { /* unreadable tags index as none */ }
    if (!Array.isArray(tags)) tags = [];
    tags = tags.filter(t => typeof t === 'string');

    let state = null;
    try {
        const commit = await txQuery('SELECT state_json, state_gzip FROM commits WHERE id = $1', [p.published_commit_id]);
        if (commit[0]) state = decodeStateRow(commit[0]);
    } catch (e) {
        // A state we cannot read still gets indexed from its listing text, so the sweep
        // does not retry it forever.
        console.error(`[gallery-index] could not read state for ${projectId}:`, e.message);
    }
    const name = p.published_name ?? '';
    const description = p.published_description ?? '';
    const facets = deriveFacets(state, { name, tags });

    await txQuery('DELETE FROM project_tags WHERE project_id = $1', [projectId]);
    const seen = new Set();
    for (const label of tags) {
        const tag = normalizeTag(label);
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        await txQuery('INSERT INTO project_tags (project_id, tag, label) VALUES ($1, $2, $3)', [projectId, tag, label]);
    }

    await txQuery('DELETE FROM project_formats WHERE project_id = $1', [projectId]);
    for (const format of facets.formats) {
        await txQuery('INSERT INTO project_formats (project_id, format) VALUES ($1, $2)', [projectId, format]);
    }

    const searchText = [name, tags.join(' '), description].join(' ').toLowerCase();
    if (dbType === 'postgres') {
        // Weighted so a name hit outranks a tag hit outranks a description hit.
        await txQuery(
            `INSERT INTO project_facets (project_id, index_version, category, page_count, search_text, search_vector)
             VALUES ($1, $2, $3, $4, $5,
                 setweight(to_tsvector('english', $6), 'A') || setweight(to_tsvector('english', $7), 'B')
                 || setweight(to_tsvector('english', $8), 'C'))
             ON CONFLICT (project_id) DO UPDATE SET index_version = EXCLUDED.index_version,
                 category = EXCLUDED.category, page_count = EXCLUDED.page_count,
                 search_text = EXCLUDED.search_text, search_vector = EXCLUDED.search_vector`,
            [projectId, INDEX_VERSION, facets.category, facets.pageCount, searchText, name, tags.join(' '), description]);
    } else {
        await txQuery(
            `INSERT INTO project_facets (project_id, index_version, category, page_count, search_text)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (project_id) DO UPDATE SET index_version = EXCLUDED.index_version,
                 category = EXCLUDED.category, page_count = EXCLUDED.page_count,
                 search_text = EXCLUDED.search_text`,
            [projectId, INDEX_VERSION, facets.category, facets.pageCount, searchText]);
    }
}

// project_stats is kept by the reviews triggers and stays valid across an unpublish (the
// reviews do), so only a project deletion drops it.
export async function deleteGalleryIndex(projectId, txQuery, { keepStats = false } = {}) {
    await txQuery('DELETE FROM project_tags WHERE project_id = $1', [projectId]);
    await txQuery('DELETE FROM project_formats WHERE project_id = $1', [projectId]);
    await txQuery('DELETE FROM project_facets WHERE project_id = $1', [projectId]);
    if (!keepStats) {
        await txQuery('DELETE FROM project_stats WHERE project_id = $1', [projectId]);
        await txQuery('DELETE FROM download_events WHERE project_id = $1', [projectId]);
    }
}

// Backfills projects published before the index existed, and rebuilds every row whose
// index_version is older than INDEX_VERSION (a rule in shared/galleryFacets.js changed).
// Idempotent and safe alongside live publishes; one transaction per project so a long sweep
// never holds a lock for long.
export async function reindexStale({ batchSize = 100 } = {}) {
    let total = 0;
    const failed = new Set();
    for (;;) {
        const rows = await query(
            `SELECT p.id FROM projects p
             LEFT JOIN project_facets f ON f.project_id = p.id
             WHERE p.visibility = 'public' AND p.published_commit_id IS NOT NULL
               AND (f.project_id IS NULL OR f.index_version < $1)
             ORDER BY p.id LIMIT $2`,
            [INDEX_VERSION, batchSize + failed.size]);
        const todo = rows.map(r => r.id).filter(id => !failed.has(id));
        if (todo.length === 0) break;
        for (const id of todo) {
            try {
                await withTransaction(tx => reindexProject(id, tx));
                total++;
            } catch (e) {
                failed.add(id);
                console.error(`[gallery-index] reindex failed for ${id}:`, e.message);
            }
        }
    }
    if (total > 0) console.log(`[gallery-index] indexed ${total} project(s)`);
    return total;
}
