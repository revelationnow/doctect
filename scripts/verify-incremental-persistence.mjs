import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BLANK = ['DATABASE_URL', 'RESEND_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GEMINI_API_KEY', 'API_KEY', 'SIGNUP_CAP'];
/**
 * Dependency ports describe consumed operations, not entire Node modules.
 * @typedef {Record<string, string | undefined>} Environment
 * @typedef {{phase: string, webPort: number, apiPort: number, outputDir: string}} RunOptions
 * @typedef {object} PrepareIO
 * @property {(path: string) => Promise<string>} realpath
 * @property {(path: string) => Promise<unknown>} lstat Only existence is inspected.
 * @property {(path: string, options: {mode: number}) => Promise<unknown>} mkdir
 * @property {(path: string, data: string, options?: {flag: string, mode: number}) => Promise<void>} writeFile
 * @typedef {PrepareIO & {readFile: (path: string, encoding: 'utf8') => Promise<string>}} VerificationIO
 * @typedef {{io?: PrepareIO, checkPort?: (port: number) => Promise<void>}} PrepareDependencies
 * @typedef {{env: Environment, log: string}} CommandOptions
 * @typedef {(command: string, args: string[], options: CommandOptions) => Promise<number>} CommandExecutor
 * @typedef {Pick<import('node:events').EventEmitter, 'once'> & {
 *   pid?: number, stdout: import('node:stream').Readable, stderr: import('node:stream').Readable
 * }} CommandChild
 * @typedef {object} ExecuteDependencies
 * @property {Pick<import('node:events').EventEmitter, 'on' | 'off'>} [owner]
 * @property {(pid: number, signal: NodeJS.Signals) => unknown} [kill]
 * @property {(path: string, options: {flags: 'wx', mode: number}) => import('node:stream').Writable} [createWriteStream]
 * @property {(command: string, args: string[], options: {
 *   cwd: string, env: Environment, detached: boolean, stdio: ['ignore', 'pipe', 'pipe']
 * }) => CommandChild} [spawn]
 * @typedef {Pick<import('node:events').EventEmitter, 'once'> & {
 *   close: (callback: (error?: Error) => void) => unknown, closeAllConnections?: () => void
 * }} ApiServer
 * @typedef {{close: () => Promise<void>, httpServer: {closeAllConnections?: () => void}}} PreviewServer
 * @typedef {{root: string, preview: {host: string, port: number, strictPort: boolean}}} PreviewOptions
 * @typedef {object} ServerDependencies
 * @property {(port: number) => Promise<void>} [checkPort]
 * @property {() => Promise<{
 *   app: {listen: (port: number, host: string, callback: () => void) => ApiServer},
 *   preview: (options: PreviewOptions) => Promise<PreviewServer>
 * }>} [initialize]
 * @typedef {Pick<import('node:events').EventEmitter, 'once' | 'off'> & {
 *   stdin: Pick<import('node:events').EventEmitter, 'once' | 'off'> & {resume: () => unknown},
 *   exit: (code: number) => unknown
 * }} ServerOwner
 * @typedef {(command: string, args: string[], options: {
 *   cwd: string, encoding: 'utf8', maxBuffer: number
 * }) => string} GitReader
 */
export function parseOptions(args) {
  const values = {};
  const names = { '--phase': 'phase', '--web-port': 'webPort', '--api-port': 'apiPort', '--output-dir': 'outputDir' };
  for (let i = 0; i < args.length; i += 2) {
    const key = names[args[i]];
    if (!key || !args[i + 1] || key in values) throw new Error('Expected --phase baseline|final --web-port N --api-port N --output-dir PATH');
    values[key] = key.endsWith('Port') ? Number(args[i + 1]) : args[i + 1];
  }
  validateOptions(values);
  return values;
}
function validateOptions(options) {
  if (!['baseline', 'final'].includes(options.phase)) throw new Error('phase must be baseline or final');
  for (const port of [options.webPort, options.apiPort]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3000, 3001].includes(port)) throw new Error('Unsafe verification port');
  }
  if (options.webPort === options.apiPort) throw new Error('Web/API ports must differ');
  if (typeof options.outputDir !== 'string' || !options.outputDir.startsWith('/tmp/opencode/') || resolve(options.outputDir) !== options.outputDir) throw new Error('output directory must be fresh and under /tmp/opencode');
}
/** @param {RunOptions} options @param {Environment} inherited @returns {Environment} */
export function isolatedEnvironment(options, inherited = process.env) {
  const env = {};
  // Do not inherit arbitrary provider, Node preload, proxy or browser flags.
  for (const key of ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'DISPLAY', 'XDG_RUNTIME_DIR', 'PLAYWRIGHT_BROWSERS_PATH']) {
    if (inherited[key] !== undefined) env[key] = inherited[key];
  }
  const web = `http://localhost:${options.webPort}`, api = `http://localhost:${options.apiPort}`;
  Object.assign(env, Object.fromEntries(BLANK.map(key => [key, ''])), {
    DOTENV_CONFIG_PATH: `${options.outputDir}/empty.env`, DOTENV_CONFIG_OVERRIDE: 'false',
    SQLITE_PATH: `${options.outputDir}/api.sqlite`, BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    PORT: String(options.apiPort), CLIENT_URL: web, BETTER_AUTH_URL: `${api}/api/auth`,
    OWNER_EMAILS: 'incremental-owner@test.dev', E2E_OWNER_EMAIL: 'incremental-owner@test.dev',
    TRUSTED_ORIGINS: `${web},${api}`, VITE_API_URL: `${api}/api/auth`, VITE_API_BASE: api,
    E2E_WEB_PORT: String(options.webPort), E2E_API_PORT: String(options.apiPort), E2E_BUILT_BUNDLE: '1',
    INCREMENTAL_PERFORMANCE_PHASE: options.phase, INCREMENTAL_OUTPUT_DIR: options.outputDir,
    PLAYWRIGHT_HTML_OUTPUT_DIR: `${options.outputDir}/playwright-report`, PLAYWRIGHT_HTML_OPEN: 'never',
    NO_COLOR: '1',
  });
  return env;
}
export function validateEnvironment(options, env) {
  const expected = isolatedEnvironment(options, {});
  for (const key of Object.keys(expected).filter(key => key !== 'BETTER_AUTH_SECRET')) {
    if (env[key] !== expected[key]) throw new Error(`Unsafe isolated environment: ${key}`);
  }
  if (!/^[a-f0-9]{64}$/.test(env.BETTER_AUTH_SECRET)) throw new Error('Unsafe isolated environment: secret');
}
export async function checkPort(port) {
  // Check IPv4 and IPv6 loopback; never contact, stop, or reuse an existing server.
  for (const host of ['127.0.0.1', '::1']) {
    await new Promise((done, reject) => {
      const server = createServer();
      server.once('error', error => {
        if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) done();
        else reject(new Error(`Occupied or unavailable port ${port}: ${error.code}`));
      });
      server.listen({ host, port, exclusive: true }, () => server.close(error => error ? reject(error) : done()));
    });
  }
}
/** @param {RunOptions} options @param {PrepareDependencies} dependencies */
export async function prepareRun(options, { io = fs, checkPort: inspectPort = checkPort } = {}) {
  validateOptions(options);
  if (await io.realpath(dirname(options.outputDir)) !== dirname(options.outputDir)) throw new Error('Refusing symlink output parent');
  try { await io.lstat(options.outputDir); throw new Error('A fresh output directory is required'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await inspectPort(options.webPort);
  await inspectPort(options.apiPort);
  await io.mkdir(options.outputDir, { mode: 0o700 });
  await io.writeFile(`${options.outputDir}/empty.env`, '', { flag: 'wx', mode: 0o600 });
  return isolatedEnvironment(options);
}
/**
 * @param {string} command
 * @param {string[]} args
 * @param {CommandOptions} options
 * @param {ExecuteDependencies} dependencies
 * @returns {Promise<number>}
 */
export function execute(command, args, { env, log }, dependencies = {}) {
  const owner = dependencies.owner ?? process;
  const kill = dependencies.kill ?? process.kill.bind(process);
  return new Promise((done, reject) => {
    const output = (dependencies.createWriteStream ?? createWriteStream)(log, { flags: 'wx', mode: 0o600 });
    const child = (dependencies.spawn ?? spawn)(command, args, { cwd: ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let interrupted = 0, timer;
    const signalGroup = signal => {
      if (!child.pid) return;
      try { kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const interrupt = code => {
      if (interrupted) return;
      interrupted = code;
      // Playwright handles SIGINT by tearing down its detached webServer. npx
      // alone does not forward parent termination to its descendants.
      signalGroup('SIGINT');
      timer = setTimeout(() => signalGroup('SIGKILL'), 10_000);
      timer.unref();
    };
    const onInt = () => interrupt(130), onTerm = () => interrupt(143);
    const cleanup = () => {
      clearTimeout(timer);
      owner.off('SIGINT', onInt); owner.off('SIGTERM', onTerm);
    };
    owner.on('SIGINT', onInt); owner.on('SIGTERM', onTerm);
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
    output.once('error', error => { signalGroup('SIGINT'); cleanup(); reject(error); });
    child.once('error', error => { cleanup(); output.end(); reject(error); });
    child.once('close', code => { cleanup(); output.end(() => done(interrupted || (code ?? 1))); });
  });
}

async function initializeTestServer() {
  // Mirror server/index.js initialization, not its wildcard listen. Validation
  // occurs before dotenv/auth/db imports, so this test-only path cannot select
  // a production database or load the normal .env file.
  await import('dotenv/config');
  if (!globalThis.crypto) globalThis.crypto = (await import('node:crypto')).webcrypto;
  const { assertOwnerConfiguration, reconcileOwnerAuthority } = await import('../server/ownerAuthority.js');
  assertOwnerConfiguration();
  const { runMigrations } = await import('../server/migrations.js');
  await runMigrations();
  await reconcileOwnerAuthority();
  const { createApp } = await import('../server/app.js');
  const { preview } = await import('vite');
  return { app: createApp(), preview };
}

/** @param {Environment} env @param {ServerDependencies} dependencies */
export async function startTestServer(env = process.env, dependencies = {}) {
  const options = { phase: env.INCREMENTAL_PERFORMANCE_PHASE, webPort: Number(env.E2E_WEB_PORT), apiPort: Number(env.E2E_API_PORT), outputDir: env.INCREMENTAL_OUTPUT_DIR };
  validateOptions(options);
  validateEnvironment(options, env);
  await (dependencies.checkPort ?? checkPort)(options.webPort);
  await (dependencies.checkPort ?? checkPort)(options.apiPort);
  const { app, preview } = await (dependencies.initialize ?? initializeTestServer)();
  let api, web, apiListening = false;
  const close = async () => {
    const closing = [];
    if (web) { web.httpServer.closeAllConnections?.(); closing.push(web.close()); }
    if (apiListening) {
      api.closeAllConnections?.();
      closing.push(new Promise((done, reject) => api.close(error => error ? reject(error) : done())));
    }
    await Promise.all(closing);
  };
  try {
    await new Promise((done, reject) => {
      api = app.listen(options.apiPort, '127.0.0.1', () => { apiListening = true; done(); });
      api.once('error', reject);
    });
    web = await preview({ root: ROOT, preview: { host: '127.0.0.1', port: options.webPort, strictPort: true } });
    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** @param {{owner?: ServerOwner, start?: () => Promise<{close: () => Promise<void>}>}} dependencies */
export async function serveTestServer({ owner = process, start = startTestServer } = {}) {
  let stop;
  const stopped = new Promise(done => { stop = done; });
  owner.once('SIGINT', stop); owner.once('SIGTERM', stop);
  // Playwright owns this pipe. EOF also closes listeners if its process dies
  // without running teardown; no detached concurrently grandchildren survive.
  owner.stdin.once('end', stop); owner.stdin.resume();
  try {
    const server = await start();
    await stopped;
    await server.close();
  } finally {
    owner.off('SIGINT', stop); owner.off('SIGTERM', stop); owner.stdin.off('end', stop);
  }
  owner.exit(0);
}
/** @param {string} log @param {GitReader} git */
export function confirmBaselineFailure(log, git = execFileSync) {
  const failures = log.match(/^ FAIL .+$/gm) ?? [];
  if (failures.length !== 1 || failures[0] !== ' FAIL  tests/unit/onboarding/bundle.test.js > built page > matches a fresh build under normalized timestamp and SHA metadata' ||
      !/^\s*Tests\s+1 failed \| \d+ passed/m.test(log) || !/^\s*Test Files\s+1 failed \| \d+ passed/m.test(log)) return null;
  // Independently inspect immutable base blobs, not the modified file tree.
  // A stored per-file size mismatch alone disproves the base bundle equality.
  const base = '8a2872d';
  const opts = { cwd: ROOT, encoding: 'utf8', maxBuffer: 20_000_000 };
  const html = git('git', ['show', `${base}:onboarding/index.html`], opts);
  const data = JSON.parse(html.match(/window.DOCTECT = \{data: (.*), content: /)[1]);
  const sizes = new Map(git('git', ['ls-tree', '-r', '-l', base], opts).trim().split('\n').map(line => {
    const [meta, path] = line.split('\t');
    return [path, Number(meta.trim().split(/\s+/).at(-1))];
  }));
  const mismatches = [];
  const visit = node => {
    if (node.kind === 'file' && sizes.has(node.path) && sizes.get(node.path) !== node.size) {
      mismatches.push({ path: node.path, committedBundleBytes: node.size, baseBlobBytes: sizes.get(node.path) });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(data.tree);
  return mismatches.length ? { base, mismatches, failure: failures[0].trim() } : null;
}
/**
 * @param {RunOptions} options
 * @param {{io?: VerificationIO, checkPort?: (port: number) => Promise<void>, execute?: CommandExecutor}} dependencies
 */
export async function runVerification(options, dependencies = {}) {
  const io = dependencies.io ?? fs;
  const env = await prepareRun(options, dependencies);
  validateEnvironment(options, env);
  // Task 15 extends the final release gate; both phases already share isolation.
  const commands = [
    ['npx', ['vitest', 'run', 'tests/unit/incrementalFixtures.test.ts', 'tests/unit/incrementalVerificationLauncher.test.ts', 'tests/unit/incrementalInputCapture.test.ts']],
    ['npx', ['vitest', 'run', 'tests/unit/localWorkspace/mutationQueue.test.ts', 'tests/unit/localWorkspace/projectPreparationClient.test.ts', 'tests/unit/useWorkspaceProjectWrites.test.tsx', 'tests/unit/projectDocumentSnapshot.test.ts']],
    ['npx', ['vitest', 'run']],
    ['npm', ['run', 'build', '--legacy-peer-deps']],
    ['npx', ['playwright', 'test', 'tests/e2e/incremental_performance.spec.ts', '--project=incremental-performance-chromium']],
  ];
  const results = [];
  for (const [index, [command, args]] of commands.entries()) {
    const log = `${options.outputDir}/${index + 1}-${command}.log`;
    console.log(`Running ${command} ${args.join(' ')}; log: ${log}`);
    const commandEnv = { ...env };
    if (args[0] === 'vitest') {
      // Existing unit helpers allocate one SQLite file per test worker. Giving
      // all workers the API database couples otherwise isolated suites.
      delete commandEnv.SQLITE_PATH;
      delete commandEnv.INCREMENTAL_PERFORMANCE_PHASE;
      delete commandEnv.E2E_BUILT_BUNDLE;
      commandEnv.TMPDIR = options.outputDir;
      commandEnv.VITEST_MAX_WORKERS = '4';
    }
    const code = await (dependencies.execute ?? execute)(command, args, { env: commandEnv, log });
    const baselineConcern = code !== 0 && options.phase === 'baseline' && index === 2
      ? confirmBaselineFailure(await io.readFile(log, 'utf8')) : null;
    results.push({ command, args, code, log, ...(baselineConcern ? { baselineConcern } : {}) });
    await io.writeFile(`${options.outputDir}/commands.json`, JSON.stringify({ phase: options.phase, results }, null, 2));
    if (code !== 0 && !baselineConcern) throw new Error(`Verification stopped: ${command} exited ${code}; ${log}`);
    if (baselineConcern) console.warn('Confirmed baseline-only onboarding bundle mismatch; preserving failure and continuing measurement.');
  }
  return results;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => runVerification(parseOptions(process.argv.slice(2)))).then(results => {
    if (results.some(result => result.code !== 0)) {
      console.warn('Baseline evidence complete with recorded baseline-only failure; exit 2.');
      process.exitCode = 2;
    }
  }).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
