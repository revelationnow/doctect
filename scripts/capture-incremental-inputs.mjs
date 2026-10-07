import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = '/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/sticker-press-redesign';
const DESTINATION = '/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/incremental-local-persistence';
export const INPUTS = [
  { source: 'docs/superpowers/specs/2026-09-13-incremental-local-persistence-design.md', destination: 'docs/superpowers/specs/2026-09-13-incremental-local-persistence-design.md' },
  { source: 'docs/superpowers/plans/2026-09-13-incremental-local-persistence.md', destination: 'docs/superpowers/plans/2026-09-13-incremental-local-persistence.md' },
  { source: 'gallery-samples/21-sticker-press/templates.js', destination: 'tests/fixtures/incremental/sticker-press/templates.js' },
  { source: 'gallery-samples/21-sticker-press/hierarchy.js', destination: 'tests/fixtures/incremental/sticker-press/hierarchy.js' },
];

async function checkPath(path, io) {
  try {
    if (await io.realpath(path) !== path) throw new Error(`Refusing symlink path: ${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await checkPath(dirname(path), io);
  }
}

/**
 * Only the filesystem operations and argument forms used by capture.
 * @typedef {object} CaptureIO
 * @property {(path: string) => Promise<Buffer>} readFile
 * @property {(path: string) => Promise<string>} realpath
 * @property {(path: string, options: {recursive: true}) => Promise<string | void>} mkdir
 * @property {(path: string, bytes: Buffer, options: {flag: 'wx'}) => Promise<void>} writeFile
 */

/**
 * Capture only the four approved inputs. No source mutation or arbitrary output path.
 * @param {string[]} inputs
 * @param {{io?: CaptureIO}} dependencies
 */
export async function captureInputs(inputs, { io = fs } = {}) {
  if (inputs.length !== INPUTS.length || inputs.some((input, index) => input !== `${SOURCE}/${INPUTS[index].source}`)) {
    throw new Error('Supply the four exact approved input paths in spec, plan, templates, hierarchy order.');
  }
  const prepared = [];
  for (const [index, source] of inputs.entries()) {
    const destination = `${DESTINATION}/${INPUTS[index].destination}`;
    await checkPath(source, io);
    await checkPath(destination, io);
    const bytes = await io.readFile(source);
    let existing;
    try { existing = await io.readFile(destination); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing && !bytes.equals(existing)) throw new Error(`Refusing different existing bytes: ${destination}`);
    prepared.push({ source, destination, bytes, existing });
  }
  // All four inputs and destinations pass validation before any generation.
  for (const entry of prepared) {
    if (!entry.existing) {
      await io.mkdir(dirname(entry.destination), { recursive: true });
      await io.writeFile(entry.destination, entry.bytes, { flag: 'wx' });
    }
    if (!entry.bytes.equals(await io.readFile(entry.destination))) throw new Error(`Byte verification failed: ${entry.destination}`);
  }
  return prepared.map(({ source, destination, bytes }) => ({
    source, destination, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  captureInputs(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
