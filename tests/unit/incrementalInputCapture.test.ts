// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { captureInputs, INPUTS } from '../../scripts/capture-incremental-inputs.mjs';
import type { CaptureIO } from '../../scripts/capture-incremental-inputs.mjs';

const sourceRoot = '/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/sticker-press-redesign';
const outputRoot = '/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence';
function harness() {
  const files = new Map<string, Buffer>(INPUTS.map(({ source }) => [
    `${sourceRoot}/${source}`, Buffer.from(`credits preserved\n${'é'.repeat(4000)}\n`),
  ]));
  const writes: string[] = [];
  return {
    files, writes,
    io: {
      readFile: async (path: string) => {
        if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return files.get(path)!;
      },
      realpath: async (path: string) => path,
      mkdir: async () => {},
      writeFile: async (path: string, bytes: Buffer) => { writes.push(path); files.set(path, bytes); },
    } satisfies CaptureIO,
  };
}
const sources = INPUTS.map(({ source }) => `${sourceRoot}/${source}`);
describe('approved input capture', () => {
  it('preserves byte identity, credits and lines exceeding 2000 characters', async () => {
    const h = harness();
    const result = await captureInputs(sources, { io: h.io });
    expect(result).toHaveLength(4);
    for (const [i, entry] of result.entries()) {
      expect(h.files.get(`${outputRoot}/${INPUTS[i].destination}`)).toEqual(h.files.get(sources[i]));
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.bytes).toBeGreaterThan(8000);
    }
    expect(h.writes).toHaveLength(4);
  });
  it('refuses all writes when any destination differs', async () => {
    const h = harness();
    h.files.set(`${outputRoot}/${INPUTS[3].destination}`, Buffer.from('different'));
    await expect(captureInputs(sources, { io: h.io })).rejects.toThrow(/different/);
    expect(h.writes).toEqual([]);
  });
  it('allows byte-identical retry without writes', async () => {
    const h = harness();
    await captureInputs(sources, { io: h.io });
    h.writes.length = 0;
    await captureInputs(sources, { io: h.io });
    expect(h.writes).toEqual([]);
  });
  it('refuses unapproved inputs before writing', async () => {
    const h = harness();
    await expect(captureInputs([...sources.slice(0, 3), `${sourceRoot}/.env`], { io: h.io })).rejects.toThrow(/exact approved/);
    expect(h.writes).toEqual([]);
  });
  it('rejects symlink escapes before writing', async () => {
    const h = harness();
    h.io.realpath = async () => '/elsewhere';
    await expect(captureInputs(sources, { io: h.io })).rejects.toThrow(/symlink/);
    expect(h.writes).toEqual([]);
  });
});
