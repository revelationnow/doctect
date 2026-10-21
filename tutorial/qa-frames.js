// Contact sheets of a finished episode: one frame at the end of every beat
// (its settled result), plus one mid-beat for long beats.
// Runs at the end of assemble.js → <out>/qa/sheet-NN.jpg
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { episodeOutDir, PYTHON, TUTORIAL_DIR } from './lib/episode.js';

const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function qaFrames(episode) {
    const outDir = episodeOutDir(episode);
    const timeline = JSON.parse(fs.readFileSync(path.join(outDir, 'timeline.json'), 'utf8'));
    const samples = [];
    for (const b of timeline.beats) {
        const len = b.end - b.start;
        if (len > 8) samples.push({ t: b.start + len * 0.5, label: `beat ${b.beat} mid · ${mmss(b.start + len * 0.5)}${b.chapter ? ` · ${b.chapter}` : ''}` });
        samples.push({ t: Math.max(b.start, b.end - 0.25), label: `beat ${b.beat} end · ${mmss(b.end)}${b.chapter ? ` · ${b.chapter}` : ''}` });
    }
    const qaDir = path.join(outDir, 'qa');
    fs.rmSync(qaDir, { recursive: true, force: true });
    fs.mkdirSync(qaDir, { recursive: true });
    fs.writeFileSync(path.join(qaDir, 'samples.json'), JSON.stringify(samples));
    const res = spawnSync(PYTHON,
        [path.join(TUTORIAL_DIR, 'video', 'sheet.py'), path.join(outDir, `${episode.meta.id}.mp4`), path.join(qaDir, 'samples.json'), path.join(qaDir, 'sheet')],
        { encoding: 'utf8' });
    if (res.status !== 0) throw new Error(res.stderr);
    process.stdout.write(res.stdout);
    return fs.readdirSync(qaDir).filter(f => f.startsWith('sheet-')).map(f => path.join(qaDir, f));
}
