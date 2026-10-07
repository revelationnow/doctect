// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as launcher from '../../scripts/verify-incremental-persistence.mjs';
import { parseOptions, isolatedEnvironment, validateEnvironment, prepareRun, runVerification, confirmBaselineFailure } from '../../scripts/verify-incremental-persistence.mjs';

const options = { phase: 'baseline', webPort: 4310, apiPort: 4311, outputDir: '/tmp/opencode/launcher-unit-fixture' };
function harness() {
  const writes: string[] = [];
  const io: launcher.VerificationIO = {
    realpath: async (path: string) => path,
    lstat: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    mkdir: async (path: string) => { writes.push(path); },
    writeFile: async (path: string) => { writes.push(path); },
    readFile: async () => { throw new Error('No failed command log in the successful-run fixture'); },
  };
  return { writes, io, checkPort: vi.fn(async (_port: number) => {}),
    execute: vi.fn<launcher.CommandExecutor>(async (_command, _args, _options) => 0) };
}
describe('incremental verification isolation', () => {
  it.each(['SIGINT', 'SIGTERM'])('forwards %s to only its owned command and waits for cleanup', async signal => {
    const owner = new EventEmitter();
    const child = Object.assign(new EventEmitter(), { pid: 12345, stdout: new PassThrough(), stderr: new PassThrough() });
    const spawn = vi.fn<NonNullable<launcher.ExecuteDependencies['spawn']>>((_command, _args, _options) => child);
    const kill = vi.fn();
    const pending = launcher.execute('npx', ['playwright', 'test'], { env: {}, log: 'injected-only' }, {
      owner, spawn, kill, createWriteStream: () => new PassThrough(),
    });
    expect(spawn.mock.calls[0][2].detached).toBe(true);
    owner.emit(signal);
    expect(kill).toHaveBeenCalledExactlyOnceWith(-12345, 'SIGINT');
    child.emit('close', 0);
    expect(await pending).toBe(signal === 'SIGINT' ? 130 : 143);
    expect(owner.listenerCount('SIGINT')).toBe(0);
    expect(owner.listenerCount('SIGTERM')).toBe(0);
  });
  it('owns both loopback listeners and closes API if preview startup fails', async () => {
    const close = vi.fn(callback => callback());
    const api = Object.assign(new EventEmitter(), { close, closeAllConnections: vi.fn() });
    const listen = vi.fn((_port, _host, callback) => { queueMicrotask(callback); return api; });
    const preview = vi.fn(async (_options: launcher.PreviewOptions): Promise<launcher.PreviewServer> => { throw new Error('preview failed'); });
    await expect(launcher.startTestServer(isolatedEnvironment(options, {}), {
      checkPort: vi.fn(async () => {}), initialize: async () => ({ app: { listen }, preview }),
    })).rejects.toThrow('preview failed');
    expect(listen.mock.calls[0].slice(0, 2)).toEqual([4311, '127.0.0.1']);
    expect(preview.mock.calls[0][0].preview).toEqual({ host: '127.0.0.1', port: 4310, strictPort: true });
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(['SIGINT', 'SIGTERM', 'end'])('closes owned listeners on %s, including loss of Playwright stdin', async event => {
    const owner = Object.assign(new EventEmitter(), { stdin: Object.assign(new EventEmitter(), { resume: vi.fn() }), exit: vi.fn() });
    const close = vi.fn(async () => {});
    const stopped = launcher.serveTestServer({ owner, start: async () => ({ close }) });
    (event === 'end' ? owner.stdin : owner).emit(event);
    await stopped;
    expect(close).toHaveBeenCalledOnce();
    expect(owner.exit).toHaveBeenCalledWith(0);
  });
  it('closes both successfully started listeners and rejects unsafe env before initialization', async () => {
    const api = Object.assign(new EventEmitter(), { close: vi.fn(callback => callback()), closeAllConnections: vi.fn() });
    const web = { close: vi.fn(async () => {}), httpServer: { closeAllConnections: vi.fn() } };
    const initialize = vi.fn(async () => ({
      app: { listen: (_port, _host, callback) => { queueMicrotask(callback); return api; } },
      preview: async () => web,
    }));
    const deps = { checkPort: vi.fn(async () => {}), initialize };
    await expect(launcher.startTestServer({ ...isolatedEnvironment(options, {}), DATABASE_URL: 'postgres://forbidden' }, deps)).rejects.toThrow(/environment/);
    expect(initialize).not.toHaveBeenCalled();
    const server = await launcher.startTestServer(isolatedEnvironment(options, {}), deps);
    await server.close();
    expect(api.close).toHaveBeenCalledOnce();
    expect(web.close).toHaveBeenCalledOnce();
  });
  it('preserves an API bind failure without trying to close a listener it never owned', async () => {
    const api = Object.assign(new EventEmitter(), { close: vi.fn(callback => callback(new Error('not running'))) });
    const initialize = async () => ({
      app: { listen: () => { queueMicrotask(() => api.emit('error', new Error('address occupied'))); return api; } },
      preview: vi.fn(),
    });
    await expect(launcher.startTestServer(isolatedEnvironment(options, {}), { checkPort: vi.fn(async () => {}), initialize })).rejects.toThrow('address occupied');
    expect(api.close).not.toHaveBeenCalled();
  });
  it('uses one owned test-only loopback server instead of detached concurrently descendants', () => {
    const env = isolatedEnvironment(options, {});
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    try {
      const require = createRequire(import.meta.url);
      delete require.cache[require.resolve('../../playwright.config.cjs')];
      const config = require('../../playwright.config.cjs');
      expect(config.webServer.command).toBe('node scripts/incremental-test-server.mjs');
      expect(config.webServer.gracefulShutdown).toEqual({ signal: 'SIGTERM', timeout: 5000 });
    } finally { vi.unstubAllEnvs(); }
  });
  it('parses the exact launcher interface', () => {
    expect(parseOptions(['--phase', 'baseline', '--web-port', '4310', '--api-port', '4311', '--output-dir', options.outputDir])).toEqual(options);
    expect(() => parseOptions(['--phase', 'unknown'])).toThrow();
  });
  it.each([3000, 3001, 0, 65536, 4311])('refuses unsafe web port %s before generating artifacts', async webPort => {
    const h = harness();
    await expect(prepareRun({ ...options, webPort }, h)).rejects.toThrow(/port/i);
    expect(h.writes).toEqual([]);
  });
  it('refuses occupied ports instead of stopping or reusing servers', async () => {
    const h = harness();
    h.checkPort.mockRejectedValue(new Error('occupied port'));
    await expect(prepareRun(options, h)).rejects.toThrow(/occupied/);
    expect(h.writes).toEqual([]);
  });
  it('refuses a reused output directory', async () => {
    const h = harness();
    h.io.lstat = async () => ({});
    await expect(prepareRun(options, h)).rejects.toThrow(/fresh/);
    expect(h.writes).toEqual([]);
  });
  it.each(['/tmp/elsewhere', '/tmp/opencode/../escape', '/tmp/opencode'])('refuses non-isolated output %s', async outputDir => {
    const h = harness();
    await expect(prepareRun({ ...options, outputDir }, h)).rejects.toThrow(/output/i);
    expect(h.writes).toEqual([]);
  });
  it('refuses a symlinked output parent', async () => {
    const h = harness();
    h.io.realpath = async () => '/elsewhere';
    await expect(prepareRun(options, h)).rejects.toThrow(/symlink/);
  });
  it('discards production database/email/provider environment and generates a local secret', () => {
    const env = isolatedEnvironment(options, { PATH: '/usr/bin', DATABASE_URL: 'postgres://production', SQLITE_PATH: '/user.db', GOOGLE_CLIENT_SECRET: 'secret', RESEND_API_KEY: 'secret', NODE_OPTIONS: '--require danger', VITE_API_BASE: 'https://production' });
    expect(env.DATABASE_URL).toBe('');
    expect(env.SQLITE_PATH).toBe(`${options.outputDir}/api.sqlite`);
    expect(env.DOTENV_CONFIG_PATH).toBe(`${options.outputDir}/empty.env`);
    expect(env.DOTENV_CONFIG_OVERRIDE).toBe('false');
    expect(env.RESEND_API_KEY).toBe('');
    expect(env.GOOGLE_CLIENT_SECRET).toBe('');
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.BETTER_AUTH_SECRET).toHaveLength(64);
    expect(env.VITE_API_BASE).toBe('http://localhost:4311');
    expect(env.INCREMENTAL_PERFORMANCE_PHASE).toBe('baseline');
    expect(env.E2E_BUILT_BUNDLE).toBe('1');
    expect(() => validateEnvironment(options, { ...env, DATABASE_URL: 'postgres://production' })).toThrow(/environment/);
    expect(() => validateEnvironment(options, { ...env, E2E_BUILT_BUNDLE: '0' })).toThrow(/environment/);
  });
  it('runs baseline commands with injected execution, not future correctness files', async () => {
    const h = harness();
    await runVerification(options, h);
    const commands = h.execute.mock.calls.map(([command, args]) => `${command} ${args.join(' ')}`);
    expect(commands[0]).toContain('incrementalFixtures.test.ts');
    expect(commands.some(command => command.includes('projectDocumentSnapshot.test.ts'))).toBe(true);
    expect(commands).toContain('npx vitest run');
    expect(commands).toContain('npm run build --legacy-peer-deps');
    expect(commands.at(-1)).toContain('--project=incremental-performance-chromium');
    expect(commands.join('\n')).not.toMatch(/incremental_migration|incremental_local_persistence/);
    for (const call of h.execute.mock.calls) expect(call[2].env.DATABASE_URL).toBe('');
    const unitEnv = h.execute.mock.calls[2][2].env;
    expect(unitEnv.SQLITE_PATH).toBeUndefined();
    expect(unitEnv.TMPDIR).toBe(options.outputDir);
    expect(unitEnv.INCREMENTAL_PERFORMANCE_PHASE).toBeUndefined();
    expect(unitEnv.E2E_BUILT_BUNDLE).toBeUndefined();
    expect(unitEnv.VITEST_MAX_WORKERS).toBe('4');
  });
  it('recognizes only the exact independently evidenced baseline bundle failure', () => {
    const log = ' FAIL  tests/unit/onboarding/bundle.test.js > built page > matches a fresh build under normalized timestamp and SHA metadata\n Test Files  1 failed | 243 passed (244)\n      Tests  1 failed | 3480 passed (3481)\n';
    const git = vi.fn<launcher.GitReader>((_command, args, _options) => args[0] === 'show'
      ? '<script>window.DOCTECT = {data: {"tree":{"kind":"dir","children":[{"kind":"file","path":"server/app.js","size":1}]}}, content: {}'
      : '100644 blob abc 2\tserver/app.js\n');
    expect(confirmBaselineFailure(log, git)?.mismatches).toHaveLength(1);
    expect(confirmBaselineFailure(`${log} FAIL  tests/unit/other.test.ts > failure\n`, git)).toBeNull();
    expect(confirmBaselineFailure('unexpected failure', git)).toBeNull();
  });
  it('config isolates the performance spec from generic and unlimited-storage projects', () => {
    for (const [key, value] of Object.entries(isolatedEnvironment(options, {}))) vi.stubEnv(key, value);
    const require = createRequire(import.meta.url);
    delete require.cache[require.resolve('../../playwright.config.cjs')];
    const config = require('../../playwright.config.cjs');
    const performance = config.projects.find(project => project.name === 'incremental-performance-chromium');
    expect(performance?.testMatch.toString()).toBe('/incremental_performance\\.spec\\.ts$/');
    expect(performance?.use.launchOptions.args).toEqual([]);
    for (const name of ['chromium', 'firefox', 'webkit']) {
      expect(config.projects.find(project => project.name === name).testIgnore.test('incremental_performance.spec.ts')).toBe(true);
    }
    expect(config.webServer.reuseExistingServer).toBe(false);
    vi.unstubAllEnvs();
  });
});
