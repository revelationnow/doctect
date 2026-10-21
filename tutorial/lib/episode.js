// Paths shared by the pipeline, and the storyboard contract.
//
// An episode module exports:
//   meta  — { id, number, level, title, summary, learn: [..], docs: [..],
//             prev?, next?: { number, title, summary }, thumbnail?: { beat, headline } }
//   setup — optional async (ctx) => void, runs off camera before capture
//   teardown — optional async (ctx) => void, runs off camera after the last beat
//   beats — [{ chapter?, say?, at?, do?, hold?, lowerThird?, allowAlert? }]
//     say  — caption text (see lib/speech.js for [shown](=spoken) overrides)
//     at   — when `do` starts: a sentence index (default 0, with the first
//            word), '1.5s' (seconds into the narration), 'end' (once the
//            narration finishes), or 'before' (act first, then narrate)
//     do   — async (page, ctx) => void
//     hold — extra seconds of quiet after the beat (default 0.45)
//
// Each CLI (narrate, record, assemble) loads its episode with exactly
// `import(path.resolve(process.argv[2]))`, the one dynamic import the
// repository's workspace-boundary policy allows these files, and passes the
// module to checkEpisode().
import fs from 'node:fs';
import path from 'node:path';

export const TUTORIAL_DIR = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
export const ROOT = path.dirname(TUTORIAL_DIR);
export const VIDEOS_DIR = path.join(ROOT, 'tutorial-videos');
// Everything generated or downloaded lives under tutorial/build (gitignored,
// and a directory name the workspace-boundary scan already skips).
export const BUILD_DIR = path.join(TUTORIAL_DIR, 'build');
export const CACHE_DIR = path.join(BUILD_DIR, 'cache');
export const MODELS_DIR = path.join(BUILD_DIR, 'models');
export const PYTHON = path.join(BUILD_DIR, 'venv', 'bin', 'python');
// Projects one episode leaves behind for a later one to start from (committed,
// so any episode can be re-recorded on its own).
export const FIXTURES_DIR = path.join(TUTORIAL_DIR, 'fixtures');
export const fixturePath = (name) => path.join(FIXTURES_DIR, `${name}.json`);

export function checkEpisode(mod, file) {
    const { meta, beats } = mod;
    if (!meta?.id || !meta?.title) throw new Error(`${file}: meta.id and meta.title are required`);
    if (!Array.isArray(beats) || beats.length === 0) throw new Error(`${file}: beats must be a non-empty array`);
    beats.forEach((b, i) => {
        if (!b.say && !b.do) throw new Error(`${file}: beat ${i} has neither say nor do`);
        if (b.at !== undefined && !(Number.isInteger(b.at) || ['end', 'before'].includes(b.at) || /^\d+(\.\d+)?s$/.test(b.at))) {
            throw new Error(`${file}: beat ${i} has an invalid "at" (${b.at})`);
        }
    });
    return { ...mod, meta, beats, file: path.resolve(file) };
}

export const episodeOutDir = (episode) => {
    const dir = path.join(VIDEOS_DIR, episode.meta.id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
};
