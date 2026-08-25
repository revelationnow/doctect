// tests/unit/server/bodyLimit.test.js
// @vitest-environment node
//
// Regression coverage for the C1 fix: MAX_STATE_BYTES (shared/projectLimits.js) rose
// to 32 MiB, but server/app.js's express.json() body limit was a hardcoded '8mb'
// literal that never moved with it. Every cloud write parses the HTTP body through
// that transport limit BEFORE validateAppState ever runs, so any real project state
// anywhere near the documented 32 MiB cap was silently rejected with a raw
// body-parser 413 -- the intended gate (validateAppState) never got a chance to run.
// These tests pin: (1) the transport limit is derived from MAX_STATE_BYTES and stays
// above it, (2) a body close to the real cap is actually accepted end-to-end, and
// (3) an oversized body still gets rejected, but as JSON the client can render, not
// Express's default HTML error page.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initTestApp, signUpUser, minimalState } from './helpers.js';
import { MAX_STATE_BYTES } from '../../../shared/projectLimits.js';

let app, cookie, JSON_BODY_LIMIT_BYTES;

beforeAll(async () => {
    app = await initTestApp();
    cookie = await signUpUser(app, { email: 'bodylimit@test.dev', username: 'bodylimit_u' });
    ({ JSON_BODY_LIMIT_BYTES } = await import('../../../server/app.js'));
});

// Builds a schema-valid AppState whose raw JSON encoding is at least `targetBytes`
// long, by padding one text element's data with an inert repeated character. Real
// project states get this large from thousands of small elements rather than one
// huge one, but body-parser only ever measures raw request bytes -- it has no idea
// about shape -- so a single padded field exercises exactly the transport-limit code
// path this file is testing, cheaply, without going anywhere near MAX_ELEMENTS or
// MAX_NODES.
const paddedState = (targetBytes) => {
    const state = minimalState('padded');
    state.variants.default.templates.page.elements.push({
        id: 'pad', type: 'text', x: 0, y: 0, width: 1, height: 1, data: { text: '' },
    });
    const overhead = new TextEncoder().encode(JSON.stringify(state)).byteLength;
    const padNeeded = Math.max(0, targetBytes - overhead);
    state.variants.default.templates.page.elements[0].data.text = 'x'.repeat(padNeeded);
    return state;
};

describe('JSON body size limit', () => {
    it('derives the transport limit from MAX_STATE_BYTES and keeps it strictly above the state cap', () => {
        expect(JSON_BODY_LIMIT_BYTES).toBeGreaterThan(MAX_STATE_BYTES);
    });

    it('accepts a request body close to MAX_STATE_BYTES instead of rejecting it at a stale transport ceiling', async () => {
        // Bigger than the old hardcoded 8mb limit and close to (but under) the real
        // 32 MiB state cap -- the exact zone that silently 413'd before this fix.
        const bigState = paddedState(24 * 1024 * 1024);
        const res = await request(app).post('/api/projects').set('Cookie', cookie)
            .send({ name: 'Big', state: bigState });
        expect(res.status).not.toBe(413);
        expect(res.status).toBe(201);
    }, 30000);

    it('still rejects a body over the transport limit, reporting JSON rather than the framework default HTML page', async () => {
        const hugeState = paddedState(JSON_BODY_LIMIT_BYTES + 1024 * 1024);
        const res = await request(app).post('/api/projects').set('Cookie', cookie)
            .send({ name: 'Huge', state: hugeState });
        expect(res.status).toBe(413);
        expect(res.headers['content-type']).toMatch(/json/);
        expect(res.body).toEqual({ error: 'Request body is too large.', code: 'PAYLOAD_TOO_LARGE' });
    }, 30000);
});
