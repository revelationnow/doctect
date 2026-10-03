// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initTestApp, signUpUser, minimalState, PNG_1X1 } from './helpers.js';

// Words and tags unique to this file keep it isolated from the shared worker DB.
const twoVariantState = () => ({
    nodes: {
        root: { id: 'root', parentId: null, type: 'cover', title: 'Cover', data: {}, children: ['a', 'b', 'ref'] },
        a: { id: 'a', parentId: 'root', type: 'page', title: 'A', data: {}, children: [] },
        b: { id: 'b', parentId: 'root', type: 'page', title: 'B', data: {}, children: [] },
        ref: { id: 'ref', parentId: 'root', type: 'page', title: 'Ref', data: {}, children: [], referenceId: 'a' },
    },
    rootId: 'root',
    variants: {
        a4: { id: 'a4', name: 'A4', templates: {
            cover: { id: 'cover', name: 'Cover', width: 595.28, height: 841.89, elements: [] },
            page: { id: 'page', name: 'Page', width: 595.28, height: 841.89, elements: [] },
        } },
        rm: { id: 'rm', name: 'reMarkable 2', templates: {
            // Landscape still counts as the same device size.
            cover: { id: 'cover', name: 'Cover', width: 592, height: 445, elements: [] },
            page: { id: 'page', name: 'Page', width: 592, height: 445, elements: [] },
        } },
    },
    activeVariantId: 'a4',
    schemaVersion: 7,
});

let app, owner, raterA, raterB, raterC, ids = {};
let query, reindexStale;

const publish = async (cookie, name, tags, state = minimalState(), description = 'd') => {
    const p = await request(app).post('/api/projects').set('Cookie', cookie).send({ name, state });
    const res = await request(app).post(`/api/projects/${p.body.project.id}/publish`).set('Cookie', cookie)
        .set('If-Match', `"${p.body.project.headCommitId}"`)
        .send({ description, tags, thumbnails: [PNG_1X1] });
    expect(res.status).toBe(200);
    return p.body.project.id;
};
const found = res => res.body.items.map(i => i.id);

beforeAll(async () => {
    app = await initTestApp();
    ({ query } = await import('../../../server/db.js'));
    ({ reindexStale } = await import('../../../server/galleryIndex.js'));
    owner = await signUpUser(app, { email: 'gi-owner@test.dev', username: 'gi_owner' });
    raterA = await signUpUser(app, { email: 'gi-ra@test.dev', username: 'gi_ra' });
    raterB = await signUpUser(app, { email: 'gi-rb@test.dev', username: 'gi_rb' });
    raterC = await signUpUser(app, { email: 'gi-rc@test.dev', username: 'gi_rc' });
    ids.planner = await publish(owner, 'Quillwort Weekly', ['gi-planners', 'weekly', 'planner'], twoVariantState(),
        'a calm undated layout');
    ids.chess = await publish(owner, 'Quillwort Openings', ['chess', 'gi-planners'], minimalState(),
        'repertoire drills for weekly study');
    ids.plain = await publish(owner, 'Quillwort Misc', ['gi-zzz']);
});

describe('derived facets', () => {
    it('stores category, formats and page count without touching the listing', async () => {
        const res = await request(app).get(`/api/gallery/${ids.planner}`);
        expect(res.body.project.category).toBe('planners');
        expect(res.body.project.formats.sort()).toEqual(['a4', 'eink_10_3']);
        expect(res.body.project.pageCount).toBe(3); // the reference node is not a page
        expect(res.body.project.tags).toEqual(['gi-planners', 'weekly', 'planner']); // original spelling kept
    });

    it('puts the same facts on cards', async () => {
        const res = await request(app).get('/api/gallery?q=quillwort');
        const card = res.body.items.find(i => i.id === ids.chess);
        expect(card.category).toBe('games');
        expect(card.formats).toEqual(['custom']);
        expect(card.pageCount).toBe(1);
        expect(res.body.items.find(i => i.id === ids.plain).category).toBe('other');
    });
});

describe('filters', () => {
    it('filters by category and by page format', async () => {
        expect(found(await request(app).get('/api/gallery?q=quillwort&category=games'))).toEqual([ids.chess]);
        expect(found(await request(app).get('/api/gallery?q=quillwort&format=eink_10_3'))).toEqual([ids.planner]);
    });

    it('folds tag plurals and case on the filter, and ANDs repeated tags', async () => {
        const either = found(await request(app).get('/api/gallery?tag=GI-Planner'));
        expect(either.sort()).toEqual([ids.planner, ids.chess].sort());
        expect(found(await request(app).get('/api/gallery?tag=gi-planner&tag=chess'))).toEqual([ids.chess]);
    });

    it('reports the total match count alongside the page', async () => {
        const res = await request(app).get('/api/gallery?q=quillwort&limit=1');
        expect(res.body.items).toHaveLength(1);
        expect(res.body.total).toBe(3);
        expect(res.body.hasMore).toBe(true);
    });
});

describe('search', () => {
    it('ANDs words, matches prefixes, and reaches tags and descriptions', async () => {
        expect(found(await request(app).get('/api/gallery?q=quillw%20repertoire'))).toEqual([ids.chess]);
        expect(found(await request(app).get('/api/gallery?q=undated'))).toEqual([ids.planner]);
    });

    it('defaults to relevance when searching: a name hit outranks a description hit', async () => {
        const res = await request(app).get('/api/gallery?q=weekly');
        expect(res.body.sort).toBe('relevance');
        expect(found(res).indexOf(ids.planner)).toBeLessThan(found(res).indexOf(ids.chess));
    });

    it('ignores operator characters instead of erroring', async () => {
        const res = await request(app).get(`/api/gallery?q=${encodeURIComponent("quillwort & | ! ' % _ :*")}`);
        expect(res.status).toBe(200);
        expect(res.body.items.length).toBe(3);
    });
});

describe('rating sort', () => {
    it('ranks three 5★ reviews above a single 5★ review', async () => {
        const rate = (cookie, id) => request(app).put(`/api/gallery/${id}/review`).set('Cookie', cookie).send({ rating: 5 });
        await rate(raterA, ids.plain);
        for (const c of [raterA, raterB, raterC]) await rate(c, ids.chess);
        const res = await request(app).get('/api/gallery?q=quillwort&sort=rating');
        expect(found(res)).toEqual([ids.chess, ids.plain, ids.planner]);
        expect(res.body.items[0].ratingAvg).toBe(5);
        expect(res.body.items[0].ratingCount).toBe(3);
    });

    it('keeps the rating cache current when a review is edited or deleted', async () => {
        await request(app).put(`/api/gallery/${ids.chess}/review`).set('Cookie', raterC).send({ rating: 2 });
        let card = (await request(app).get('/api/gallery?q=quillwort')).body.items.find(i => i.id === ids.chess);
        expect(card.ratingAvg).toBe(4);
        await request(app).delete(`/api/gallery/${ids.chess}/review`).set('Cookie', raterC);
        card = (await request(app).get('/api/gallery?q=quillwort')).body.items.find(i => i.id === ids.chess);
        expect(card.ratingCount).toBe(2);
        expect(card.ratingAvg).toBe(5);
    });

    it('filters by minimum average rating', async () => {
        expect(found(await request(app).get('/api/gallery?q=quillwort&rating=4')).sort())
            .toEqual([ids.chess, ids.plain].sort());
    });
});

describe('download counting', () => {
    it('counts one download per viewer per day', async () => {
        await request(app).get(`/api/gallery/${ids.plain}/state`);
        await request(app).get(`/api/gallery/${ids.plain}/state`);
        let detail = await request(app).get(`/api/gallery/${ids.plain}`);
        expect(detail.body.project.downloadCount).toBe(1);
        await request(app).get(`/api/gallery/${ids.plain}/state`).set('Cookie', raterB);
        detail = await request(app).get(`/api/gallery/${ids.plain}`);
        expect(detail.body.project.downloadCount).toBe(2);
    });
});

describe('GET /api/gallery/home and /facets', () => {
    it('returns bounded rows, including per-category rows', async () => {
        const res = await request(app).get('/api/gallery/home');
        expect(res.status).toBe(200);
        expect(res.body.trending.length).toBeLessThanOrEqual(8);
        expect(res.body.newest.map(i => i.id)).toContain(ids.plain);
        const games = res.body.categories.find(c => c.key === 'games');
        expect(games.label).toBe('Games & play');
        expect(games.items.map(i => i.id)).toContain(ids.chess);
        expect(res.body.spotlight).not.toBeNull();
    });

    it('counts categories and formats in canonical order, with folded tag labels', async () => {
        const res = await request(app).get('/api/gallery/facets');
        expect(res.body.categories.find(c => c.key === 'games').count).toBeGreaterThanOrEqual(1);
        expect(res.body.formats.find(f => f.key === 'eink_10_3').label).toMatch(/10\.3/);
        expect(res.body.tags.find(t => t.tag === 'gi-planner')).toEqual({ tag: 'gi-planner', label: 'gi-planners', count: 2 });
    });
});

describe('backfill of projects published before the index existed', () => {
    it('indexes them from the published data and leaves the project itself byte-identical', async () => {
        const id = await publish(owner, 'Quillwort Legacy', ['gi-legacy']);
        // Simulate a project published before migration 018: no derived rows at all.
        for (const t of ['project_tags', 'project_formats', 'project_facets']) {
            await query(`DELETE FROM ${t} WHERE project_id = $1`, [id]);
        }
        const projectBefore = await query('SELECT * FROM projects WHERE id = $1', [id]);
        const commitsBefore = await query('SELECT * FROM commits WHERE project_id = $1 ORDER BY id', [id]);
        expect(found(await request(app).get('/api/gallery?tag=gi-legacy'))).toEqual([]);
        // Still listed while unindexed, just not filterable yet.
        expect(found(await request(app).get('/api/gallery?sort=recent&limit=24'))).toContain(id);

        expect(await reindexStale()).toBeGreaterThanOrEqual(1);

        expect(found(await request(app).get('/api/gallery?tag=gi-legacy'))).toEqual([id]);
        expect((await request(app).get(`/api/gallery/${id}`)).body.project.category).toBe('other');
        expect(await query('SELECT * FROM projects WHERE id = $1', [id])).toEqual(projectBefore);
        expect(await query('SELECT * FROM commits WHERE project_id = $1 ORDER BY id', [id])).toEqual(commitsBefore);
    });

    it('rebuilds rows written under an older index version', async () => {
        await query('UPDATE project_facets SET index_version = 0, category = $1 WHERE project_id = $2', ['work', ids.chess]);
        await reindexStale();
        expect((await request(app).get(`/api/gallery/${ids.chess}`)).body.project.category).toBe('games');
    });

    it('drops the derived rows when an indexed project is deleted', async () => {
        const id = await publish(owner, 'Quillwort Doomed', ['gi-doomed']);
        await request(app).delete(`/api/projects/${id}`).set('Cookie', owner);
        expect(await query('SELECT * FROM project_tags WHERE project_id = $1', [id])).toEqual([]);
        expect(await query('SELECT * FROM project_facets WHERE project_id = $1', [id])).toEqual([]);
    });
});
