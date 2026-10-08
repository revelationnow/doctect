const { defineConfig, devices } = require('@playwright/test');

const webPort = Number(process.env.E2E_WEB_PORT || 3000);
const apiPort = Number(process.env.E2E_API_PORT || 3001);
if (!Number.isInteger(webPort) || webPort <= 0 || !Number.isInteger(apiPort) || apiPort <= 0) {
    throw new Error('E2E_WEB_PORT and E2E_API_PORT must be positive integers');
}
const webOrigin = `http://localhost:${webPort}`;
const apiOrigin = `http://localhost:${apiPort}`;
const builtBundle = process.env.E2E_BUILT_BUNDLE === '1';
// An explicitly empty/invalid phase must fail closed, not select ordinary startup.
const incremental = process.env.INCREMENTAL_PERFORMANCE_PHASE !== undefined;
if (incremental) {
    // Keep this CJS gate local: Playwright rewrites required .mjs modules as
    // CommonJS, so importing the ESM launcher here fails before test discovery.
    const output = process.env.INCREMENTAL_OUTPUT_DIR;
    if (!['baseline', 'final'].includes(process.env.INCREMENTAL_PERFORMANCE_PHASE)
        || !builtBundle || [webPort, apiPort].some(port => port < 1024 || port > 65535 || [3000, 3001].includes(port))
        || webPort === apiPort || !output?.startsWith('/tmp/opencode/')
        || require('node:path').resolve(output) !== output
        || process.env.SQLITE_PATH !== `${output}/api.sqlite`
        || process.env.DOTENV_CONFIG_PATH !== `${output}/empty.env`
        || process.env.DOTENV_CONFIG_OVERRIDE !== 'false'
        || ['DATABASE_URL', 'RESEND_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GEMINI_API_KEY', 'API_KEY'].some(key => process.env[key] !== '')
        || !/^[a-f0-9]{64}$/.test(process.env.BETTER_AUTH_SECRET || '')) {
        throw new Error('Use the isolated incremental verification launcher environment');
    }
}
process.env.E2E_API_BASE = apiOrigin;

const e2eOwnerEmail = process.env.E2E_OWNER_EMAIL || `owner-${Date.now()}-${process.pid}@test.dev`;
process.env.E2E_OWNER_EMAIL = e2eOwnerEmail;

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
    testDir: './tests/e2e',
    /* Run tests in files in parallel */
    fullyParallel: true,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Shared dev server and SQLite state make cross-file browser concurrency nondeterministic. */
    workers: 1,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: 'html',
    ...(incremental ? { outputDir: `${process.env.INCREMENTAL_OUTPUT_DIR}/test-results` } : {}),
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /* Base URL to use in actions like `await page.goto('/')`. */
        baseURL: webOrigin,

        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
        viewport: { width: 1280, height: 720 },
    },

    /* Configure projects for major browsers */
    projects: [
        {
            name: 'chromium',
            testIgnore: [/incremental_performance\.spec\.ts$/, /mobile_editor\.spec\.js$/],
            use: {
                ...devices['Desktop Chrome'],
                ...(builtBundle ? { launchOptions: { args: ['--unlimited-storage'] } } : {}),
            },
        },

        {
            name: 'firefox',
            testIgnore: [/incremental_performance\.spec\.ts$/, /mobile_editor\.spec\.js$/],
            use: { ...devices['Desktop Firefox'] },
        },

        {
            name: 'webkit',
            testIgnore: [/incremental_performance\.spec\.ts$/, /mobile_editor\.spec\.js$/],
            use: { ...devices['Desktop Safari'] },
        },
        {
            name: 'workspace-large-chromium',
            testMatch: /local_workspace_migration\.spec\.js/,
            grep: /aggregate legacy JSON above 5 MiB/,
            use: {
                ...devices['Desktop Chrome'],
                launchOptions: { args: ['--unlimited-storage'] },
            },
        },
        ...(incremental ? [{
            name: 'incremental-performance-chromium',
            testMatch: /incremental_performance\.spec\.ts$/,
            use: {
                ...devices['Desktop Chrome'],
                launchOptions: { args: [] },
                serviceWorkers: 'block',
                trace: 'off',
            },
        }] : []),
        {
            name: 'workspace-large-firefox',
            testMatch: /local_workspace_migration\.spec\.js/,
            grep: /aggregate legacy JSON above 5 MiB/,
            use: {
                ...devices['Desktop Firefox'],
                launchOptions: { firefoxUserPrefs: { 'dom.storage.default_quota': 20480 } },
            },
        },
        // Touch editor (phone/tablet emulation). Only mobile_editor.spec.js runs here; the desktop
        // projects ignore that file. WebKit cannot launch on the current dev host, so local runs use
        // the chromium pair; the webkit pair is for CI.
        {
            name: 'mobile-phone-chromium',
            testMatch: /mobile_editor\.spec\.js$/,
            use: { ...devices['iPhone 13'], browserName: 'chromium' },
        },
        {
            name: 'mobile-phone-webkit',
            testMatch: /mobile_editor\.spec\.js$/,
            use: { ...devices['iPhone 13'] },
        },
        {
            name: 'mobile-tablet-chromium',
            testMatch: /mobile_editor\.spec\.js$/,
            use: { ...devices['iPad (gen 7)'], browserName: 'chromium' },
        },
        {
            name: 'mobile-tablet-webkit',
            testMatch: /mobile_editor\.spec\.js$/,
            use: { ...devices['iPad (gen 7)'] },
        },
    ],

    /* Run your local dev server before starting the tests.
     *
     * RESEND_API_KEY is force-emptied: the dev server loads .env, and a real
     * key there once made every e2e signup send a REAL email (each full run
     * burns 10-15 sends of Resend quota on @test.dev addresses). Empty means
     * server/email.js uses its console fallback — same fail-safe as the unit
     * suite. reuseExistingServer remains OFF: reusing an already-running dev
     * server would bypass this env and use whatever key that server loaded.
     * Alternate E2E_WEB_PORT / E2E_API_PORT values avoid disturbing existing
     * 3000 / 3001 processes while preserving explicit server ownership.
     */
    webServer: {
        command: incremental
            ? 'node scripts/incremental-test-server.mjs'
            : builtBundle
            ? `npm run build && npx concurrently --kill-others-on-fail "vite preview --host 127.0.0.1 --port ${webPort} --strictPort" "node server/index.js"`
            : `npx concurrently --kill-others-on-fail "vite --host 127.0.0.1 --port ${webPort} --strictPort" "node server/index.js"`,
        url: webOrigin,
        reuseExistingServer: false,
        ...(incremental ? { gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } } : {}),
        env: {
            ...process.env,
            PORT: String(apiPort),
            RESEND_API_KEY: '',
            SIGNUP_CAP: '',
            OWNER_EMAILS: e2eOwnerEmail,
            CLIENT_URL: webOrigin,
            BETTER_AUTH_URL: `${apiOrigin}/api/auth`,
            TRUSTED_ORIGINS: `${webOrigin},${apiOrigin}`,
            VITE_API_URL: `${apiOrigin}/api/auth`,
            VITE_API_BASE: apiOrigin,
        },
    },
});
