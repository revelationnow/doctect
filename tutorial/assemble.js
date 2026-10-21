// Assembles a recorded episode into its deliverables.
// Usage: node tutorial/assemble.js <episode-module> [--no-foley] [--keep-frames]
// Also writes <out>/qa/sheet-NN.jpg contact sheets for visual review.
//
// <out>/<id>.mp4          1080p30 H.264 + AAC, -16 LUFS
// <out>/<id>.vtt / .srt   captions, timed per sentence (long ones split)
// <out>/chapters.txt      YouTube chapter list
// <out>/transcript.md     narration by chapter
// <out>/description.md    YouTube-ready description
// <out>/thumbnail.png     1280×720
// Text deliverables and the thumbnail are mirrored to tutorial/published/<id>/.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkEpisode, episodeOutDir, PYTHON, TUTORIAL_DIR } from './lib/episode.js';
import { renderThumbnail } from './lib/thumbnail.js';
import { qaFrames } from './qa-frames.js';
const run = (cmd, args, opts = {}) => {
    const res = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
    if (res.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}… failed:\n${(res.stderr || '').slice(-1500)}`);
    return res;
};
const stamp = (t, sep = '.') => {
    const ms = Math.max(0, Math.round(t * 1000));
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
};
const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Two lines of at most `width` chars, broken at the space nearest the middle. */
function twoLines(text, width = 42) {
    if (text.length <= width) return text;
    const mid = text.length / 2;
    let best = -1;
    for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/** Splits a sentence into caption-sized chunks, preferring punctuation breaks. */
function chunk(text, max = 84) {
    if (text.length <= max) return [text];
    const words = text.split(' ');
    const out = [];
    let cur = '';
    for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (next.length > max && cur) { out.push(cur); cur = w; } else cur = next;
        if (cur.length > max * 0.55 && /[,;:—–]$/.test(cur)) { out.push(cur); cur = ''; }
    }
    if (cur) out.push(cur);
    return out;
}

export function buildCues(narration, timeline) {
    const starts = new Map(timeline.beats.map(b => [b.beat, b.narrationStart]));
    const cues = [];
    for (const beat of narration.beats) {
        if (!starts.has(beat.beat)) continue;
        for (const s of beat.sentences) {
            const t = starts.get(beat.beat) + s.start;
            const parts = chunk(s.display);
            const total = parts.reduce((a, p) => a + p.length, 0);
            let at = t;
            for (const p of parts) {
                const d = s.duration * (p.length / total);
                cues.push({ start: at, end: at + d, text: twoLines(p) });
                at += d;
            }
        }
    }
    // never let a cue overlap the next one
    for (let i = 0; i + 1 < cues.length; i++) cues[i].end = Math.min(cues[i].end + 0.25, cues[i + 1].start);
    return cues;
}

export function chaptersOf(episode, timeline) {
    const list = timeline.beats.filter(b => b.chapter).map(b => ({ t: b.start, title: b.chapter }));
    if (!list.length || list[0].t > 1) list.unshift({ t: 0, title: 'Intro' });
    list[0].t = 0;
    return list;
}

function writeText(episode, narration, timeline, outDir) {
    const id = episode.meta.id;
    const cues = buildCues(narration, timeline);
    fs.writeFileSync(path.join(outDir, `${id}.vtt`), 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n'));
    fs.writeFileSync(path.join(outDir, `${id}.srt`), cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`).join('\n'));

    const chapters = chaptersOf(episode, timeline);
    const chapterLines = chapters.map(c => `${mmss(c.t)} ${c.title}`);
    fs.writeFileSync(path.join(outDir, 'chapters.txt'), chapterLines.join('\n') + '\n');

    const m = episode.meta;
    const lines = [`# ${m.title}`, '', `*Episode ${m.number} · ${m.level} · ${mmss(timeline.end)}*`, ''];
    for (const beat of narration.beats) {
        const tb = timeline.beats.find(b => b.beat === beat.beat);
        if (!tb) continue;
        if (tb.chapter) lines.push(`## ${tb.chapter}`, '');
        const text = beat.sentences.map(s => s.display).join(' ');
        if (text) lines.push(text, '');
    }
    fs.writeFileSync(path.join(outDir, 'transcript.md'), lines.join('\n'));

    const desc = [
        `${m.title} | PDF Architect tutorial ${m.number} of ${m.seriesLength ?? 12} (${m.level})`,
        '',
        m.description ?? m.summary,
        '',
        'In this video:',
        ...(m.learn ?? []).map(l => `• ${l}`),
        '',
        'Chapters:',
        ...chapterLines,
    ];
    if (m.docs?.length) desc.push('', 'Read more in the in-app docs:', ...m.docs.map(d => `• ${d}`));
    if (m.prev) desc.push('', `Previous: Episode ${m.prev.number}, ${m.prev.title}`);
    if (m.next) desc.push(`Next: Episode ${m.next.number}, ${m.next.title}`);
    desc.push('', 'Narration is synthesized (Kokoro-82M); everything on screen is the real app, recorded live.');
    fs.writeFileSync(path.join(outDir, 'description.md'), desc.join('\n') + '\n');
    return { cues: cues.length, chapters: chapters.length };
}

function loudnorm(input, output) {
    const target = 'I=-16:TP=-1.5:LRA=11';
    const pre = 'highpass=f=75,acompressor=threshold=-21dB:ratio=2.2:attack=6:release=140:makeup=1.5';
    const probe = run('ffmpeg', ['-hide_banner', '-i', input, '-af', `${pre},loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
    const json = JSON.parse(probe.stderr.slice(probe.stderr.lastIndexOf('{')));
    const second = `${pre},loudnorm=${target}:measured_I=${json.input_i}:measured_TP=${json.input_tp}:measured_LRA=${json.input_lra}`
        + `:measured_thresh=${json.input_thresh}:offset=${json.target_offset}:linear=true`;
    run('ffmpeg', ['-y', '-hide_banner', '-i', input, '-af', second, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', output]);
    return json;
}

export async function assembleEpisode(episode, { foley = true, keepFrames = false } = {}) {
    const outDir = episodeOutDir(episode);
    const id = episode.meta.id;
    const narration = JSON.parse(fs.readFileSync(path.join(outDir, 'narration.json'), 'utf8'));
    const timeline = JSON.parse(fs.readFileSync(path.join(outDir, 'timeline.json'), 'utf8'));
    const framesDir = path.join(outDir, 'frames');

    console.log('composing video…');
    run(PYTHON, [path.join(TUTORIAL_DIR, 'video', 'compose.py'), framesDir, path.join(outDir, 'timeline.json'), path.join(outDir, 'video.mp4')], { stdio: ['ignore', 'inherit', 'inherit'] });
    console.log('mixing audio…');
    run(PYTHON, [path.join(TUTORIAL_DIR, 'video', 'mix.py'), path.join(outDir, 'narration.json'), path.join(outDir, 'timeline.json'),
        path.join(outDir, 'mix.wav'), ...(foley ? [] : ['--no-foley'])]);
    const loud = loudnorm(path.join(outDir, 'mix.wav'), path.join(outDir, 'audio.m4a'));
    const final = path.join(outDir, `${id}.mp4`);
    run('ffmpeg', ['-y', '-hide_banner', '-i', path.join(outDir, 'video.mp4'), '-i', path.join(outDir, 'audio.m4a'),
        '-map', '0:v', '-map', '1:a', '-c', 'copy', '-shortest', '-movflags', '+faststart',
        '-metadata', `title=${episode.meta.title}`, final]);

    const text = writeText(episode, narration, timeline, outDir);
    const thumbAt = episode.meta.thumbnail?.beat !== undefined
        ? timeline.beats.find(b => b.beat === episode.meta.thumbnail.beat)?.end - 0.3
        : timeline.end * 0.5;
    const frames = fs.readFileSync(path.join(framesDir, 'frames.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const target = timeline.t0 + thumbAt;
    const frame = frames.reduce((best, f) => (f.t <= target ? f : best), frames[0]);
    await renderThumbnail({ meta: episode.meta, frameFile: path.join(framesDir, frame.file), out: path.join(outDir, 'thumbnail.png') });

    const published = path.join(TUTORIAL_DIR, 'published', id);
    fs.mkdirSync(published, { recursive: true });
    for (const f of ['description.md', 'transcript.md', 'chapters.txt', `${id}.vtt`, `${id}.srt`, 'thumbnail.png']) {
        fs.copyFileSync(path.join(outDir, f), path.join(published, f));
    }
    for (const f of ['video.mp4', 'audio.m4a', 'mix.wav']) fs.rmSync(path.join(outDir, f), { force: true });
    if (!keepFrames) fs.rmSync(framesDir, { recursive: true, force: true });

    qaFrames(episode);
    const size = fs.statSync(final).size / 1e6;
    const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', final]).toString());
    console.log(`assembled ${final}: ${mmss(dur)}, ${size.toFixed(1)} MB, input loudness ${Number(loud.input_i).toFixed(1)} LUFS → -16; ${text.cues} cues, ${text.chapters} chapters`);
    return { final, duration: dur, size };
}

if (process.argv[1]?.endsWith('assemble.js') && process.argv[2]) {
    const episode = checkEpisode(await import(path.resolve(process.argv[2])), process.argv[2]);
    await assembleEpisode(episode, { foley: !process.argv.includes('--no-foley'), keepFrames: process.argv.includes('--keep-frames') });
}
