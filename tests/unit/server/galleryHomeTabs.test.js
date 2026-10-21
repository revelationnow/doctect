// @vitest-environment node
// The gallery home has two tabs: planners & notebooks (everything that is not a single-page
// note template) and templates (the 'templates' category). Each tab's spotlight and rows hold
// only its own kind, so a batch of new templates cannot crowd the planners off the landing.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initTestApp, signUpUser, minimalState, PNG_1X1 } from './helpers.js';

let app, owner;
const ids = {};

const publish = async (name, tags) => {
    const p = await request(app).post('/api/projects').set('Cookie', owner).send({ name, state: minimalState(name) });
    const res = await request(app).post(`/api/projects/${p.body.project.id}/publish`).set('Cookie', owner)
        .set('If-Match', `"${p.body.project.headCommitId}"`)
        .send({ description: 'd', tags, thumbnails: [PNG_1X1] });
    expect(res.status).toBe(200);
    return p.body.project.id;
};

const homeItems = body => [
    ...(body.spotlight ? [body.spotlight] : []),
    ...body.trending, ...body.newest, ...body.categories.flatMap(c => c.items),
];

beforeAll(async () => {
    app = await initTestApp();
    owner = await signUpUser(app, { email: 'tabs-owner@test.dev', username: 'tabs_owner' });
    ids.planner = await publish('Tabsworth Planner', ['planner', 'weekly']);
    ids.journal = await publish('Tabsworth Journal', ['journal']);
    ids.cornell = await publish('Tabsworth Cornell', ['template', 'insert', 'stationery']);
    ids.dots = await publish('Tabsworth Dots', ['template', 'paper', 'dot-grid']);
});

describe('GET /api/gallery/home tabs', () => {
    it('defaults to planners & notebooks and leaves templates out of every row', async () => {
        const res = await request(app).get('/api/gallery/home');
        expect(res.status).toBe(200);
        expect(res.body.tab).toBe('planners');
        const items = homeItems(res.body);
        expect(items.length).toBeGreaterThan(0);
        expect(items.every(i => i.category !== 'templates')).toBe(true);
        expect(res.body.newest.map(i => i.id)).toEqual(expect.arrayContaining([ids.planner, ids.journal]));
        expect(res.body.categories.map(c => c.key)).not.toContain('templates');
    });

    it('shows only templates on the templates tab', async () => {
        const res = await request(app).get('/api/gallery/home?tab=templates');
        expect(res.status).toBe(200);
        expect(res.body.tab).toBe('templates');
        const items = homeItems(res.body);
        expect(items.every(i => i.category === 'templates')).toBe(true);
        expect(res.body.newest.map(i => i.id)).toEqual(expect.arrayContaining([ids.cornell, ids.dots]));
        expect(res.body.spotlight.category).toBe('templates');
        expect(res.body.categories).toEqual([]);
    });

    it('reads an unknown tab as planners', async () => {
        const res = await request(app).get('/api/gallery/home?tab=bogus');
        expect(res.status).toBe(200);
        expect(res.body.tab).toBe('planners');
    });
});
