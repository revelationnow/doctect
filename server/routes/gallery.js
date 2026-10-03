import { Router } from 'express';
import { createHash, randomUUID } from 'crypto';
import { dbType, query, withTransaction } from '../db.js';
import { optionalAuth, requireAdmin, requireAuth, requireUsername } from '../middleware/guards.js';
import { userWriteLimiter } from '../middleware/limits.js';
import { lockUser } from '../moderationSupport.js';
import { canModerateRole } from '../ownerAuthority.js';
import { insertPlatformAudit, validateReason } from '../platformAudit.js';
import { decodeStateRow } from '../stateCodec.js';
import { lockProjectRows } from '../projectLocks.js';
import { ALL_CATEGORIES, ALL_FORMATS, normalizeTag } from '../../shared/galleryFacets.js';

const router = Router();

router.get('/api/thumbnails/:thumbId', async (req, res) => {
    const rows = await query(
        `SELECT t.mime, t.image FROM thumbnails t
         JOIN projects p ON p.id = t.project_id
         WHERE t.id = $1 AND p.visibility = 'public' AND p.published_commit_id IS NOT NULL`,
        [req.params.thumbId]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const img = Buffer.isBuffer(rows[0].image) ? rows[0].image : Buffer.from(rows[0].image);
    res.set('Content-Type', rows[0].mime)
        .set('X-Content-Type-Options', 'nosniff')
        .set('Cache-Control', 'public, max-age=86400')
        // These are already-public, unauthenticated images meant to be embedded from the
        // client origin (which may differ from the API origin — see VITE_API_BASE). Helmet's
        // app-wide default (same-origin) would otherwise block <img> tags from loading them
        // cross-origin.
        .set('Cross-Origin-Resource-Policy', 'cross-origin')
        .send(img);
});

const PAGE_SIZE = 24;
const MAX_TAG_FILTERS = 5;
const HOME_ROW_SIZE = 8;
const SPOTLIGHT_POOL = 20;

const PUBLISHED = `p.visibility = 'public' AND p.published_commit_id IS NOT NULL`;

// Kept for the single-project detail query, where a correlated aggregate is one lookup.
const ratingFields = `
    (SELECT AVG(rv.rating) FROM reviews rv WHERE rv.project_id = p.id) AS rating_avg,
    (SELECT COUNT(*) FROM reviews rv WHERE rv.project_id = p.id) AS rating_count
`;

// Postgres returns AVG/COUNT as strings — Number() before math.
const ratingDtoFields = (r) => ({
    ratingAvg: r.rating_avg == null ? null : Math.round(Number(r.rating_avg) * 10) / 10,
    ratingCount: Number(r.rating_count ?? 0),
});

// Every card list (gallery, home rows, profile pages in routes/me.js) selects from here so
// the GalleryItem DTO is identical everywhere. Ratings come from project_stats (kept by the
// reviews triggers) so sorting by rating never aggregates reviews per request.
export const cardFrom = `projects p
    JOIN "user" u ON u.id = p.owner_id
    LEFT JOIN project_facets f ON f.project_id = p.id
    LEFT JOIN project_stats s ON s.project_id = p.id`;

export const cardFields = `
    p.id, p.published_name AS name, p.published_description AS description,
    p.published_tags AS tags, p.fork_count, p.download_count, p.published_at AS updated_at,
    u.username AS author, f.category, f.page_count,
    COALESCE(s.rating_sum, 0) AS rating_sum, COALESCE(s.rating_count, 0) AS rating_count,
    (SELECT t.id FROM thumbnails t WHERE t.project_id = p.id ORDER BY t.position LIMIT 1) AS thumbnail_id
`;

const cardDto = (r) => {
    const ratingCount = Number(r.rating_count ?? 0);
    return {
        id: r.id, name: r.name, description: r.description, tags: JSON.parse(r.tags || '[]'),
        author: r.author, forkCount: r.fork_count, downloadCount: r.download_count,
        updatedAt: r.updated_at, thumbnailId: r.thumbnail_id,
        ratingAvg: ratingCount > 0 ? Math.round((Number(r.rating_sum) / ratingCount) * 10) / 10 : null,
        ratingCount,
        // null until the startup sweep reaches a project published before the index existed.
        category: r.category ?? null,
        pageCount: r.page_count == null ? null : Number(r.page_count),
    };
};

const inPlaceholders = ids => ids.map((_, i) => `$${i + 1}`).join(', ');

// Ordered preview ids for the card rollover. Batched (one query for the whole
// page of results) because a per-row correlated subquery can't return an array
// on SQLite.
export async function thumbnailIdsByProject(projectIds) {
    const map = new Map();
    if (projectIds.length === 0) return map;
    const rows = await query(
        `SELECT id, project_id FROM thumbnails WHERE project_id IN (${inPlaceholders(projectIds)}) ORDER BY position`,
        projectIds);
    for (const r of rows) {
        if (!map.has(r.project_id)) map.set(r.project_id, []);
        map.get(r.project_id).push(r.id);
    }
    return map;
}

async function formatsByProject(projectIds) {
    const map = new Map();
    if (projectIds.length === 0) return map;
    const rows = await query(
        `SELECT project_id, format FROM project_formats WHERE project_id IN (${inPlaceholders(projectIds)}) ORDER BY format`,
        projectIds);
    for (const r of rows) {
        if (!map.has(r.project_id)) map.set(r.project_id, []);
        map.get(r.project_id).push(r.format);
    }
    return map;
}

// Rows selected with cardFields → GalleryItem DTOs.
export async function toCards(rows) {
    const ids = rows.map(r => r.id);
    const thumbs = await thumbnailIdsByProject(ids);
    const formats = await formatsByProject(ids);
    return rows.map(r => ({ ...cardDto(r), thumbnailIds: thumbs.get(r.id) ?? [], formats: formats.get(r.id) ?? [] }));
}

const ageHours = dbType === 'postgres'
    ? `GREATEST(EXTRACT(EPOCH FROM (LOCALTIMESTAMP - p.published_at)) / 3600.0, 0)`
    : `MAX((julianday('now') - julianday(p.published_at)) * 24.0, 0)`;

// Activity decayed by age (the Hacker News shape). Forks weigh more than downloads because
// they take an account; the +1 lets a brand-new project with no activity yet rank by recency.
const TRENDING = `((p.fork_count * 3 + p.download_count + 1) / POWER(${ageHours} + 2, 1.5))`;

// Bayesian average: each project starts with RATING_PRIOR_WEIGHT phantom reviews at the
// site-wide mean, so one 5★ review cannot outrank a hundred 4.8★ ones.
const RATING_PRIOR_WEIGHT = 5;
const BAYES_RATING = `((${RATING_PRIOR_WEIGHT} * (SELECT COALESCE(SUM(rating_sum) * 1.0 / NULLIF(SUM(rating_count), 0), 3) FROM project_stats)
    + COALESCE(s.rating_sum, 0)) / (${RATING_PRIOR_WEIGHT} + COALESCE(s.rating_count, 0)))`;

const SORTS = {
    trending: `${TRENDING} DESC`,
    recent: 'p.published_at DESC',
    // Unrated projects sort after every rated one.
    rating: `CASE WHEN COALESCE(s.rating_count, 0) > 0 THEN 0 ELSE 1 END, ${BAYES_RATING} DESC, COALESCE(s.rating_count, 0) DESC, p.published_at DESC`,
    popular: '(p.fork_count + p.download_count) DESC, p.published_at DESC',
};

// Words only: nothing that reaches to_tsquery/LIKE can carry an operator or a wildcard.
const searchTerms = q => (String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);

const queryList = v => (v === undefined ? [] : Array.isArray(v) ? v : [v]).map(String);

// Builds the WHERE and ORDER BY for GET /api/gallery. Placeholders are numbered in the
// order they appear in the final SQL (WHERE, then ORDER BY) because the SQLite adapter
// rewrites $n positionally; whereParamCount lets the COUNT query reuse the WHERE prefix.
function buildGalleryQuery(qs) {
    const params = [];
    const ph = v => `$${params.push(v)}`;
    const clauses = [PUBLISHED];

    const terms = searchTerms(String(qs.q ?? '').slice(0, 100));
    const tsquery = terms.map(t => `${t}:*`).join(' & ');
    if (terms.length) {
        if (dbType === 'postgres') {
            clauses.push(`f.search_vector @@ to_tsquery('english', ${ph(tsquery)})`);
        } else {
            for (const t of terms) clauses.push(`f.search_text LIKE ${ph(`%${t}%`)}`);
        }
    }
    const tags = [...new Set(queryList(qs.tag).map(t => normalizeTag(t.slice(0, 30))).filter(Boolean))]
        .slice(0, MAX_TAG_FILTERS);
    for (const tag of tags) {
        clauses.push(`EXISTS (SELECT 1 FROM project_tags pt WHERE pt.project_id = p.id AND pt.tag = ${ph(tag)})`);
    }
    const category = String(qs.category ?? '').slice(0, 40);
    if (category) clauses.push(`f.category = ${ph(category)}`);
    const format = String(qs.format ?? '').slice(0, 40);
    if (format) {
        clauses.push(`EXISTS (SELECT 1 FROM project_formats pf WHERE pf.project_id = p.id AND pf.format = ${ph(format)})`);
    }
    const minRating = Math.min(5, Math.max(0, parseInt(qs.rating ?? '0', 10) || 0));
    if (minRating > 0) {
        // avg >= n without division: sum >= n * count.
        clauses.push(`COALESCE(s.rating_count, 0) > 0 AND s.rating_sum >= ${ph(minRating)} * s.rating_count`);
    }
    const whereParamCount = params.length;

    let sort = Object.hasOwn(SORTS, qs.sort) || qs.sort === 'relevance' ? qs.sort : (terms.length ? 'relevance' : 'trending');
    if (sort === 'relevance' && !terms.length) sort = 'trending';
    let orderBy;
    if (sort === 'relevance') {
        const rank = dbType === 'postgres'
            ? `ts_rank(f.search_vector, to_tsquery('english', ${ph(tsquery)})) DESC`
            // No ranking function on SQLite: a name containing every term comes first.
            : `CASE WHEN ${terms.map(t => `LOWER(p.published_name) LIKE ${ph(`%${t}%`)}`).join(' AND ')} THEN 0 ELSE 1 END`;
        orderBy = `${rank}, ${SORTS.trending}`;
    } else {
        orderBy = SORTS[sort];
    }
    return { where: clauses.join(' AND '), orderBy: `${orderBy}, p.id`, params, whereParamCount, sort };
}

router.get('/api/gallery', async (req, res) => {
    const page = Math.max(0, parseInt(req.query.page ?? '0', 10) || 0);
    const limit = Math.min(PAGE_SIZE, Math.max(1, parseInt(req.query.limit ?? '0', 10) || PAGE_SIZE));
    const { where, orderBy, params, whereParamCount, sort } = buildGalleryQuery(req.query);
    const rows = await query(
        `SELECT ${cardFields} FROM ${cardFrom} WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT ${limit + 1} OFFSET ${page * limit}`,
        params);
    const counted = await query(`SELECT COUNT(*) AS n FROM ${cardFrom} WHERE ${where}`, params.slice(0, whereParamCount));
    const items = rows.slice(0, limit);
    res.json({
        items: await toCards(items),
        page,
        hasMore: rows.length > limit,
        total: Number(counted[0]?.n ?? 0),
        sort,
    });
});

// Counts for the filter controls, over the whole published catalog.
router.get('/api/gallery/facets', async (req, res) => {
    const total = await query(`SELECT COUNT(*) AS n FROM projects p WHERE ${PUBLISHED}`, []);
    const categoryRows = await query(
        `SELECT f.category AS k, COUNT(*) AS n FROM projects p JOIN project_facets f ON f.project_id = p.id
         WHERE ${PUBLISHED} GROUP BY f.category`, []);
    const formatRows = await query(
        `SELECT pf.format AS k, COUNT(*) AS n FROM projects p JOIN project_formats pf ON pf.project_id = p.id
         WHERE ${PUBLISHED} GROUP BY pf.format`, []);
    // MIN(label): the shortest spelling of a folded group — usually the singular.
    const tagRows = await query(
        `SELECT pt.tag, MIN(pt.label) AS label, COUNT(*) AS n FROM projects p JOIN project_tags pt ON pt.project_id = p.id
         WHERE ${PUBLISHED} GROUP BY pt.tag ORDER BY n DESC, pt.tag LIMIT 30`, []);
    const counts = rows => new Map(rows.map(r => [r.k, Number(r.n)]));
    const withCounts = (defs, map) => defs
        .filter(d => map.get(d.key) > 0)
        .map(d => ({ key: d.key, label: d.label, count: map.get(d.key) }));
    res.json({
        total: Number(total[0]?.n ?? 0),
        categories: withCounts(ALL_CATEGORIES, counts(categoryRows)),
        formats: withCounts(ALL_FORMATS, counts(formatRows)),
        tags: tagRows.map(r => ({ tag: r.tag, label: r.label, count: Number(r.n) })),
    });
});

// Deterministic within a UTC day, different across days.
const dayHash = (day) => {
    let hash = 0;
    for (const ch of day) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return hash;
};

// Everything the unfiltered gallery landing shows, in one round trip. Each row is a bounded
// query (LIMIT or a per-category ROW_NUMBER cap), so the landing never loads the catalog.
router.get('/api/gallery/home', async (req, res) => {
    const row = orderBy => query(
        `SELECT ${cardFields} FROM ${cardFrom} WHERE ${PUBLISHED} ORDER BY ${orderBy}, p.id LIMIT ${HOME_ROW_SIZE}`, []);
    const trending = await row(SORTS.trending);
    const newest = await row(SORTS.recent);
    const pool = await query(
        `SELECT ${cardFields} FROM ${cardFrom} WHERE ${PUBLISHED} ORDER BY ${SORTS.rating}, p.id LIMIT ${SPOTLIGHT_POOL}`, []);
    const ranked = await query(
        `SELECT * FROM (
             SELECT ${cardFields}, ROW_NUMBER() OVER (PARTITION BY f.category ORDER BY ${SORTS.trending}, p.id) AS rn
             FROM ${cardFrom} WHERE ${PUBLISHED} AND f.category IS NOT NULL
         ) ranked WHERE rn <= ${HOME_ROW_SIZE}`, []);

    const spotlightRow = pool.length ? pool[dayHash(new Date().toISOString().slice(0, 10)) % pool.length] : null;
    const byCategory = new Map();
    for (const r of ranked) {
        if (!byCategory.has(r.category)) byCategory.set(r.category, []);
        byCategory.get(r.category).push(r);
    }
    for (const list of byCategory.values()) list.sort((a, b) => Number(a.rn) - Number(b.rn));

    const categories = [];
    for (const c of ALL_CATEGORIES) {
        const list = byCategory.get(c.key);
        if (list?.length) categories.push({ key: c.key, label: c.label, emoji: c.emoji, items: await toCards(list) });
    }
    res.json({
        spotlight: spotlightRow ? (await toCards([spotlightRow]))[0] : null,
        trending: await toCards(trending),
        newest: await toCards(newest),
        categories,
    });
});

const loadPublicProject = async (req, res, next) => {
    const rows = await query(
        `SELECT p.*, u.username AS author FROM projects p JOIN "user" u ON u.id = p.owner_id
         WHERE p.id = $1 AND p.visibility = 'public' AND p.published_commit_id IS NOT NULL`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Project not found' });
    req.publicProject = rows[0];
    next();
};

const isPublishedProject = project => project?.visibility === 'public' && project.published_commit_id !== null;

const reviewDto = (r) => ({
    id: r.id, rating: r.rating, body: r.body || '', author: r.author,
    createdAt: r.created_at, updatedAt: r.updated_at
});

const reviewSelect = `
    SELECT r.id, r.rating, r.body, r.created_at, r.updated_at, u.username AS author
    FROM reviews r JOIN "user" u ON u.id = r.user_id
`;

router.get('/api/gallery/:id', async (req, res) => {
    const rows = await query(
        `SELECT p.*, u.username AS author, t.id AS thumbnail_id, t.node_id AS thumbnail_node_id,
                fp.id AS forked_project_id, fp.published_name AS forked_name,
                fp.visibility AS forked_visibility, fu.username AS forked_author,
                f.category, f.page_count,
                ${ratingFields}
         FROM projects p
         JOIN "user" u ON u.id = p.owner_id
         LEFT JOIN project_facets f ON f.project_id = p.id
         LEFT JOIN thumbnails t ON t.project_id = p.id
         LEFT JOIN projects fp ON fp.id = p.forked_from_project_id
         LEFT JOIN "user" fu ON fu.id = fp.owner_id
         WHERE p.id = $1 AND p.visibility = 'public' AND p.published_commit_id IS NOT NULL
         ORDER BY t.position`,
        [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Project not found' });

    const p = rows[0];
    const forkedFrom = p.forked_project_id && p.forked_visibility === 'public'
        ? { projectId: p.forked_project_id, name: p.forked_name, author: p.forked_author }
        : null;
    const formats = (await formatsByProject([p.id])).get(p.id) ?? [];
    res.json({
        project: {
            id: p.id, name: p.published_name, description: p.published_description, tags: JSON.parse(p.published_tags || '[]'),
            author: p.author, ownerId: p.owner_id, forkCount: p.fork_count, downloadCount: p.download_count,
            updatedAt: p.published_at, headCommitId: p.published_commit_id,
            thumbnailIds: rows.map(row => row.thumbnail_id).filter(Boolean),
            previews: rows.filter(row => row.thumbnail_id)
                .map(row => ({ id: row.thumbnail_id, nodeId: row.thumbnail_node_id ?? null })),
            forkedFrom,
            category: p.category ?? null,
            pageCount: p.page_count == null ? null : Number(p.page_count),
            formats,
            ...ratingDtoFields(p)
        }
    });
});

// One download per viewer per project per UTC day, so reloading cannot inflate the counts
// the Trending and Popular sorts rank by. Anonymous viewers are keyed by a hash of their IP
// (trust proxy is set in app.js), never the raw address.
const viewerKey = req => (req.user?.id
    ? `u:${req.user.id}`
    : `ip:${createHash('sha256').update(String(req.ip ?? '')).digest('hex').slice(0, 32)}`);

const countDownload = async (req, projectId) => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const inserted = await query(
        `INSERT INTO download_events (project_id, viewer_key, day) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING project_id`,
        [projectId, viewerKey(req), day]);
    if (inserted.length === 0) return;
    await query('UPDATE projects SET download_count = download_count + 1 WHERE id = $1', [projectId]);
    // Only today's rows can still dedupe anything; keep yesterday's for clock skew.
    const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    await query('DELETE FROM download_events WHERE day < $1', [yesterday]);
};

router.get('/api/gallery/:id/state', optionalAuth, loadPublicProject, async (req, res) => {
    const p = req.publicProject;
    if (!p.published_commit_id) return res.status(404).json({ error: 'Project has no content' });
    const rows = await query('SELECT state_json, state_gzip FROM commits WHERE id = $1', [p.published_commit_id]);
    if (!rows[0]) return res.status(404).json({ error: 'Commit not found' });
    await countDownload(req, p.id);
    res.json({ name: p.published_name, state: decodeStateRow(rows[0]) });
});

router.post('/api/gallery/:id/report', optionalAuth, loadPublicProject, async (req, res) => {
    const reason = String(req.body?.reason ?? '').trim().slice(0, 500);
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const created = await withTransaction(async txQuery => {
        const projects = await lockProjectRows([req.params.id], txQuery);
        if (!isPublishedProject(projects[0])) return false;
        await txQuery('INSERT INTO reports (id, project_id, reporter_user_id, reason) VALUES ($1, $2, $3, $4)',
            [randomUUID(), projects[0].id, req.user?.id ?? null, reason]);
        return true;
    });
    if (!created) return res.status(404).json({ error: 'Project not found' });
    res.status(201).json({ success: true });
});

router.get('/api/admin/reports', requireAdmin, async (req, res) => {
    const rows = await query(
        `SELECT r.*, p.name AS project_name, rv.body AS review_body, rv.rating AS review_rating
         FROM reports r
         LEFT JOIN projects p ON p.id = r.project_id
         LEFT JOIN reviews rv ON rv.id = r.review_id
         ORDER BY r.created_at DESC LIMIT 200`, []);
    res.json({ reports: rows });
});

router.post('/api/admin/projects/:id/unpublish', requireAdmin, async (req, res) => {
    const reason = validateReason(req.body?.reason);
    if (!reason) return res.status(400).json({ error: 'Invalid project unpublish request' });

    try {
        const discovered = await query('SELECT owner_id FROM projects WHERE id = $1', [req.params.id]);
        if (!discovered[0]) return res.status(404).json({ error: 'Project not found' });

        const result = await withTransaction(async txQuery => {
            const target = await lockUser(discovered[0].owner_id, txQuery);
            const projects = await lockProjectRows([req.params.id], txQuery);
            const project = projects[0];
            if (!target || !project || project.owner_id !== discovered[0].owner_id) return { status: 409 };
            if (!canModerateRole(req.user.role, target.role)) return { status: 403 };
            if (!isPublishedProject(project)) return { status: 409 };

            await txQuery(
                `UPDATE projects SET visibility = 'private', published_commit_id = NULL WHERE id = $1`,
                [project.id],
            );
            const action = await insertPlatformAudit(txQuery, {
                actorKind: 'user',
                actorUserId: req.user.id,
                actorEmail: req.user.email,
                targetUserId: target.id,
                targetEmail: target.email,
                projectId: project.id,
                reviewId: null,
                action: 'project_unpublished',
                reason,
                expiresAt: null,
                createdAt: new Date().toISOString(),
                metadata: { source: 'standalone_project', previousProjectVisibility: 'public' },
            });
            return { status: 200, action };
        });
        if (result.status === 403) return res.status(403).json({ error: 'Target is protected by role hierarchy' });
        if (result.status === 409) {
            return res.status(409).json({ error: 'Project state changed; refresh and try again' });
        }
        return res.json({ success: true, action: result.action });
    } catch (error) {
        console.error('Project unpublish failed:', error);
        return res.status(500).json({ error: 'Project unpublish failed' });
    }
});

router.get('/api/gallery/:id/reviews', optionalAuth, loadPublicProject, async (req, res) => {
    const rows = await query(
        `${reviewSelect} WHERE r.project_id = $1 ORDER BY r.updated_at DESC LIMIT 100`,
        [req.publicProject.id]);
    let myReview = null;
    if (req.user) {
        const mine = await query(
            `${reviewSelect} WHERE r.project_id = $1 AND r.user_id = $2`,
            [req.publicProject.id, req.user.id]);
        myReview = mine[0] ? reviewDto(mine[0]) : null;
    }
    res.json({ reviews: rows.map(reviewDto), myReview });
});

router.put('/api/gallery/:id/review', requireAuth, requireUsername, userWriteLimiter, loadPublicProject, async (req, res) => {
    const p = req.publicProject;
    if (p.owner_id === req.user.id) {
        return res.status(403).json({ error: "You can't review your own project" });
    }
    const rating = req.body?.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
    }
    const rawBody = req.body?.body ?? '';
    if (typeof rawBody !== 'string') return res.status(400).json({ error: 'body must be a string' });
    const body = rawBody.trim();
    if (body.length > 2000) return res.status(400).json({ error: 'review must be 2000 characters or fewer' });

    const now = new Date().toISOString();
    const result = await withTransaction(async txQuery => {
        const projects = await lockProjectRows([req.params.id], txQuery);
        const current = projects[0];
        if (!isPublishedProject(current)) return { status: 'missing' };
        if (current.owner_id === req.user.id) return { status: 'self-review' };

        await txQuery(
            `INSERT INTO reviews (id, project_id, user_id, rating, body, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (project_id, user_id)
             DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body, updated_at = EXCLUDED.updated_at`,
            [randomUUID(), current.id, req.user.id, rating, body, now, now]);
        const rows = await txQuery(
            `${reviewSelect} WHERE r.project_id = $1 AND r.user_id = $2`, [current.id, req.user.id]);
        if (!rows[0]) return { status: 'removed' };
        return { status: 'saved', review: reviewDto(rows[0]) };
    });
    if (result.status === 'missing') return res.status(404).json({ error: 'Project not found' });
    if (result.status === 'self-review') return res.status(403).json({ error: "You can't review your own project" });
    if (result.status === 'removed') return res.status(409).json({ error: 'Review was removed concurrently, try again' });
    res.json({ review: result.review });
});

router.delete('/api/gallery/:id/review', requireAuth, loadPublicProject, async (req, res) => {
    const rows = await query(
        'SELECT id FROM reviews WHERE project_id = $1 AND user_id = $2',
        [req.publicProject.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'No review to delete' });
    await query('DELETE FROM reviews WHERE id = $1', [rows[0].id]);
    res.json({ success: true });
});

router.post('/api/gallery/:id/reviews/:reviewId/report', optionalAuth, loadPublicProject, async (req, res) => {
    const reason = String(req.body?.reason ?? '').trim().slice(0, 500);
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const resolved = await query('SELECT id, project_id FROM reviews WHERE id = $1', [req.params.reviewId]);
    if (!resolved[0] || resolved[0].project_id !== req.params.id) {
        return res.status(404).json({ error: 'Review not found' });
    }

    const result = await withTransaction(async txQuery => {
        const projects = await lockProjectRows([resolved[0].project_id], txQuery);
        if (!isPublishedProject(projects[0])) return 'project-missing';

        const lockSuffix = dbType === 'postgres' ? ' FOR UPDATE' : '';
        const reviews = await txQuery(
            `SELECT id FROM reviews WHERE id = $1 AND project_id = $2${lockSuffix}`,
            [req.params.reviewId, projects[0].id]);
        if (!reviews[0]) return 'review-missing';
        await txQuery(
            'INSERT INTO reports (id, project_id, reporter_user_id, reason, review_id) VALUES ($1, $2, $3, $4, $5)',
            [randomUUID(), projects[0].id, req.user?.id ?? null, reason, reviews[0].id]);
        return 'created';
    });
    if (result === 'project-missing') return res.status(404).json({ error: 'Project not found' });
    if (result === 'review-missing') return res.status(404).json({ error: 'Review not found' });
    res.status(201).json({ success: true });
});

router.delete('/api/admin/reviews/:id', requireAdmin, async (req, res) => {
    const reason = validateReason(req.body?.reason);
    if (!reason) return res.status(400).json({ error: 'Invalid review deletion request' });

    try {
        const discovered = await query('SELECT user_id, project_id FROM reviews WHERE id = $1', [req.params.id]);
        if (!discovered[0]) return res.status(404).json({ error: 'Review not found' });

        const result = await withTransaction(async txQuery => {
            const target = await lockUser(discovered[0].user_id, txQuery);
            const projects = await lockProjectRows([discovered[0].project_id], txQuery);
            const project = projects[0];
            const lockSuffix = dbType === 'postgres' ? ' FOR UPDATE' : '';
            const reviews = await txQuery(
                `SELECT id, project_id, user_id, rating FROM reviews WHERE id = $1${lockSuffix}`,
                [req.params.id],
            );
            const review = reviews[0];
            if (!target || !project || !review
                || project.id !== discovered[0].project_id
                || review.project_id !== discovered[0].project_id
                || review.user_id !== discovered[0].user_id) return { status: 409 };
            if (!canModerateRole(req.user.role, target.role)) return { status: 403 };

            await txQuery('DELETE FROM reviews WHERE id = $1', [review.id]);
            const action = await insertPlatformAudit(txQuery, {
                actorKind: 'user',
                actorUserId: req.user.id,
                actorEmail: req.user.email,
                targetUserId: target.id,
                targetEmail: target.email,
                projectId: review.project_id,
                reviewId: review.id,
                action: 'review_deleted',
                reason,
                expiresAt: null,
                createdAt: new Date().toISOString(),
                metadata: { source: 'standalone_review', deletedReviewRating: Number(review.rating) },
            });
            return { status: 200, action };
        });
        if (result.status === 403) return res.status(403).json({ error: 'Target is protected by role hierarchy' });
        if (result.status === 409) {
            return res.status(409).json({ error: 'Review state changed; refresh and try again' });
        }
        return res.json({ success: true, action: result.action });
    } catch (error) {
        console.error('Review deletion failed:', error);
        return res.status(500).json({ error: 'Review deletion failed' });
    }
});

export default router;
