// tests/unit/server/ownerLimitExemption.test.js
// @vitest-environment node
// The configured owner (role 'owner' AND email in OWNER_EMAILS) is exempt from the per-user
// limits: project count, public project count and storage quota. The service-wide storage
// ceiling still applies to everyone. Admins and an account whose role says owner but whose
// email is not configured keep every limit; storageLimits.test.js covers ordinary users.
//
// Two sign-ups only (better-auth allows 3 per 10s per IP+path): the "role says owner, email
// not configured" case reuses the owner account with OWNER_EMAILS cleared.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { initTestApp, signUpUser, minimalState, PNG_1X1, saveProjectCommit } from './helpers.js';

const OWNER_EMAIL = 'limits-owner@test.dev';
let app, owner, admin;

beforeAll(async () => {
    app = await initTestApp();
    owner = await signUpUser(app, { email: OWNER_EMAIL, username: 'limits_owner' });
    admin = await signUpUser(app, { email: 'limits-admin@test.dev', username: 'limits_admin' });
    const { query } = await import('../../../server/db.js');
    await query(`UPDATE "user" SET role = 'owner' WHERE email = $1`, [OWNER_EMAIL]);
    await query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, ['limits-admin@test.dev']);
});
beforeEach(() => { process.env.OWNER_EMAILS = OWNER_EMAIL; });
afterEach(() => {
    process.env.OWNER_EMAILS = '';
    delete process.env.USER_STORAGE_QUOTA_MB;
    delete process.env.MAX_TOTAL_STORAGE_MB;
    delete process.env.MAX_PROJECTS_PER_USER;
    delete process.env.MAX_PUBLIC_PROJECTS_PER_USER;
});

const create = (cookie, name) => request(app).post('/api/projects').set('Cookie', cookie)
    .send({ name, state: minimalState(name) });
const publish = (cookie, project) => request(app).post(`/api/projects/${project.id}/publish`)
    .set('Cookie', cookie).set('If-Match', `"${project.headCommitId}"`)
    .send({ description: '', tags: [], thumbnails: [PNG_1X1] });

describe('configured owner', () => {
    it('creates projects beyond MAX_PROJECTS_PER_USER', async () => {
        process.env.MAX_PROJECTS_PER_USER = '1';
        expect((await create(owner, 'Owner one')).status).toBe(201);
        expect((await create(owner, 'Owner two')).status).toBe(201);
    });

    it('forks beyond MAX_PROJECTS_PER_USER', async () => {
        const source = await create(admin, 'Fork source');
        expect((await publish(admin, source.body.project)).status).toBe(200);
        process.env.MAX_PROJECTS_PER_USER = '1';
        const fork = await request(app).post(`/api/projects/${source.body.project.id}/fork`).set('Cookie', owner);
        expect(fork.status).toBe(201);
    });

    it('publishes beyond MAX_PUBLIC_PROJECTS_PER_USER', async () => {
        const a = await create(owner, 'Public A');
        const b = await create(owner, 'Public B');
        process.env.MAX_PUBLIC_PROJECTS_PER_USER = '1';
        expect((await publish(owner, a.body.project)).status).toBe(200);
        expect((await publish(owner, b.body.project)).status).toBe(200);
    });

    it('saves beyond the per-user storage quota', async () => {
        const created = await create(owner, 'Quota');
        process.env.USER_STORAGE_QUOTA_MB = '0.0000001';
        const res = await saveProjectCommit(app, owner, created.body.project.id,
            { state: minimalState('quota-next'), message: 'over' }, created.body.commit.id);
        expect(res.status).toBe(201);
        expect((await create(owner, 'Quota new')).status).toBe(201);
    });

    it('is shown no storage quota', async () => {
        const res = await request(app).get('/api/projects').set('Cookie', owner);
        expect(res.status).toBe(200);
        expect(res.body.usage.quotaBytes).toBeNull();
        const adminRes = await request(app).get('/api/projects').set('Cookie', admin);
        expect(adminRes.body.usage.quotaBytes).toBe(50 * 1024 * 1024);
    });

    it('is still stopped by the service-wide storage ceiling', async () => {
        process.env.MAX_TOTAL_STORAGE_MB = '0.0000001';
        const res = await create(owner, 'Ceiling');
        expect(res.status).toBe(507);
        expect(res.body.code).toBe('SERVICE_STORAGE_FULL');
    });
});

describe('everyone else keeps the limits', () => {
    it('stops an admin at MAX_PROJECTS_PER_USER', async () => {
        await create(admin, 'Admin first');
        process.env.MAX_PROJECTS_PER_USER = '1';
        const res = await create(admin, 'Admin over');
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('PROJECT_LIMIT_REACHED');
    });

    it('stops an admin at MAX_PUBLIC_PROJECTS_PER_USER', async () => {
        const first = await create(admin, 'Admin public one');
        const second = await create(admin, 'Admin public two');
        process.env.MAX_PUBLIC_PROJECTS_PER_USER = '1';
        await publish(admin, first.body.project);
        const res = await publish(admin, second.body.project);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('PUBLIC_LIMIT_REACHED');
    });

    it('stops an admin at the per-user storage quota', async () => {
        process.env.USER_STORAGE_QUOTA_MB = '0.0000001';
        const res = await create(admin, 'Admin quota');
        expect(res.status).toBe(413);
        expect(res.body.code).toBe('STORAGE_QUOTA_EXCEEDED');
    });

    // The owner already holds several projects from the tests above.
    it('stops an owner-role account whose email is not in OWNER_EMAILS', async () => {
        process.env.OWNER_EMAILS = 'someone-else@test.dev';
        process.env.MAX_PROJECTS_PER_USER = '1';
        const res = await create(owner, 'Unconfigured owner');
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('PROJECT_LIMIT_REACHED');
    });
});
