import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { toNodeHandler } from 'better-auth/node';
import { getAuthForRequest, isHostAllowed } from './authRequest.js';
import { logEvent, getStats } from './db.js';
import { checkOrigin, writeLimiter, requireAdmin } from './middleware/guards.js';
import meRouter from './routes/me.js';
import projectsRouter from './routes/projects.js';
import galleryRouter from './routes/gallery.js';
import mergeRequestsRouter from './routes/mergeRequests.js';
import adminModerationRouter from './routes/adminModeration.js';
import ownerModerationRouter from './routes/ownerModeration.js';
import { MAX_STATE_BYTES } from '../shared/projectLimits.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A project/commit write's JSON body is `{ name/message, state }` — the same
// encoding as MAX_STATE_BYTES (shared/projectLimits.js) plus a small amount
// of wrapper overhead (a couple of short string fields and object braces).
// Derive the transport limit from that constant, with a fixed margin for the
// wrapper, rather than a second hardcoded literal: MAX_STATE_BYTES has moved
// twice in this project's history (5 MiB -> 16 MiB -> 32 MiB) and this limit
// silently stayed behind each time, so every write within reach of the "real"
// cap was actually being rejected here first, by body-parser, before
// validateAppState (the intended gate) ever ran.
export const JSON_BODY_LIMIT_BYTES = MAX_STATE_BYTES + 4 * 1024 * 1024;

export const createApp = () => {
    const app = express();
    app.set('trust proxy', 1);

    app.use(helmet({
        contentSecurityPolicy: false, // SPA loads Google Fonts + inline styles; CSP tuning is a deferred follow-up
        crossOriginEmbedderPolicy: false
    }));

    const trustedOrigins = (process.env.TRUSTED_ORIGINS || 'http://localhost:3000,http://localhost:3001')
        .split(',').map(o => o.trim()).filter(Boolean);

    app.use(cors({
        origin: trustedOrigins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'If-Match']
    }));

    app.use((req, res, next) => {
        if (!isHostAllowed(req.headers.host)) return res.status(400).json({ error: 'Unknown host' });
        next();
    });

    // Keep plugin ban enforcement, but reserve moderation writes for audited application routes.
    app.use('/api/auth/admin', (_req, res) => res.status(404).json({ error: 'Not found' }));

    app.use('/api/auth', (req, res, next) => {
        const auth = getAuthForRequest(req);
        return toNodeHandler(auth)(req, res, next);
    });

    app.use(express.json({ limit: JSON_BODY_LIMIT_BYTES }));

    app.use('/api', checkOrigin);
    app.use('/api', writeLimiter);

    app.post('/api/track', async (req, res) => {
        const { type, payload } = req.body;
        try {
            await logEvent(type, payload);
            res.status(201).json({ success: true });
        } catch (err) {
            console.error('Error tracking event:', err);
            res.status(500).json({ error: 'Failed to track event' });
        }
    });

    app.get('/api/stats', requireAdmin, async (req, res) => {
        try {
            res.json(await getStats());
        } catch (err) {
            console.error('Error fetching stats:', err);
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    });

    app.use(meRouter);
    app.use(projectsRouter);
    app.use(galleryRouter);
    app.use(mergeRequestsRouter);
    app.use(adminModerationRouter);
    app.use(ownerModerationRouter);

    const distPath = path.join(__dirname, '../dist');
    app.use(express.static(distPath));
    app.get(/.*/, (req, res) => {
        // Must pass a relative filename + { root } rather than an absolute path: express@5.2.1's
        // res.sendFile() 404s on a bare absolute path here even when the file exists, silently
        // breaking every hard/direct load (deep link, bookmark, refresh) of any non-root client
        // route in production. { root } is also express's own recommended sendFile pattern.
        res.sendFile('index.html', { root: distPath });
    });

    // Error middleware, registered last so Express routes every earlier
    // thrown/forwarded error here (registration order determines error-handler
    // reach, not call order). Today the only realistic source is
    // express.json() above: an over-limit or unparsable body throws
    // synchronously before any route handler runs, and with no error
    // middleware at all, Express fell back to its default HTML error page —
    // useless to a client that expects JSON. Every route on this server
    // otherwise reports its own errors as { error, code? } JSON; match that
    // shape here too.
    app.use((err, req, res, next) => {
        if (err && err.type === 'entity.too.large') {
            return res.status(413).json({ error: 'Request body is too large.', code: 'PAYLOAD_TOO_LARGE' });
        }
        if (err && err.type === 'entity.parse.failed') {
            return res.status(400).json({ error: 'Request body is not valid JSON.', code: 'INVALID_JSON' });
        }
        next(err);
    });

    return app;
};
