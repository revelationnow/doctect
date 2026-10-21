// Boots throwaway API + vite servers for a recording session.
// Fail-safe env (same rules as the e2e suite): scratch SQLite, no Resend key,
// no DATABASE_URL — recordings can never touch Neon or send real email.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname;

const waitForHttp = async (url, timeoutMs = 30000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok || res.status < 500) return;
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300));
    }
    throw new Error(`server at ${url} not up after ${timeoutMs}ms`);
};

// Ports default to the historical 3001/5199 pair; pass others (or set
// TUTORIAL_API_PORT / TUTORIAL_WEB_PORT) to run a dry run beside a recording.
export async function startServers(tag, {
    apiPort = Number(process.env.TUTORIAL_API_PORT || 3001),
    webPort = Number(process.env.TUTORIAL_WEB_PORT || 5199),
} = {}) {
    const apiOrigin = `http://localhost:${apiPort}`;
    const webOrigin = `http://localhost:${webPort}`;
    const apiLog = `/tmp/tutorial-${tag}-api.log`;
    const env = { ...process.env };
    // EMPTY STRINGS, not delete: the server loads dotenv, which re-populates
    // any MISSING var from .env — deleting would hand recordings the real
    // Resend key and the real DATABASE_URL. Present-but-empty wins over .env
    // and is falsy to server/db.js and server/email.js (same trick as
    // playwright.config.cjs's webServer env).
    env.RESEND_API_KEY = '';
    env.DATABASE_URL = '';
    const sqlitePath = `/tmp/tutorial-${tag}-${Date.now()}.db`;
    Object.assign(env, {
        PORT: String(apiPort),
        SQLITE_PATH: sqlitePath,
        BETTER_AUTH_URL: `${apiOrigin}/api/auth`,
        TRUSTED_ORIGINS: `${webOrigin},${apiOrigin}`,
        CLIENT_URL: webOrigin,
    });

    // detached: true makes each child the leader of its own new process
    // group (pgid === pid). That lets stop() below kill the whole group —
    // load-bearing for vite: it's spawned via npx, which interposes a
    // wrapper process around the actual vite dev server; killing just the
    // npx PID leaves that grandchild running and :5199 bound forever, which
    // is exactly the bug this is fixing. Group-kill reaps npx's wrapper and
    // the real vite process (and anything vite itself forks) in one shot.
    const api = spawn('node', ['server/index.js'], {
        cwd: ROOT, env,
        stdio: ['ignore', fs.openSync(apiLog, 'w'), fs.openSync(apiLog, 'a')],
        detached: true,
    });
    // VITE_API_BASE is what services/cloudApi.ts prefixes every /api call
    // with; without it the client asks the vite origin for /api/me, gets a
    // 404, and every page shows "Unable to verify account authority".
    const vite = spawn('npx', ['vite', '--port', String(webPort), '--strictPort'], {
        cwd: ROOT,
        env: { ...env, VITE_API_URL: `${apiOrigin}/api/auth`, VITE_API_BASE: apiOrigin },
        stdio: 'ignore',
        detached: true,
    });

    await waitForHttp(`${apiOrigin}/api/me`);
    await waitForHttp(`${webOrigin}/`);

    return {
        apiLog,
        sqlitePath,
        apiOrigin,
        baseUrl: webOrigin,
        /** Latest verification link logged by the console-fallback mailer. */
        lastVerificationLink() {
            const log = fs.readFileSync(apiLog, 'utf8');
            const links = log.match(/https?:\/\/[^\s"'<>]+verify-email[^\s"'<>]*/g);
            return links ? links[links.length - 1] : null;
        },
        stop() {
            // Negative pid = kill the whole process group (see the spawn
            // comment above). try/catch because the group may already be
            // gone (ESRCH) — stop() must never throw, callers rely on it
            // being safe to call unconditionally during cleanup.
            try { process.kill(-api.pid, 'SIGKILL'); } catch { /* already dead */ }
            try { process.kill(-vite.pid, 'SIGKILL'); } catch { /* already dead */ }
        },
    };
}
