// Synthesizes an episode's narration, one clip per sentence, and measures it.
// Usage: node tutorial/narrate.js <episode-module> [--no-qa]
// Writes <out-dir>/narration.json:
//   { voice, speed, beats: [{ beat, chapter, duration,
//       sentences: [{ display, spoken, wav, start, duration }] }] }
// where `start` is the sentence's offset inside its beat. The recorder paces
// each beat to these numbers; the assembler lays each clip at its real time.
//
// Providers: kokoro (default; local, no network) or chirp (Google Chirp 3 HD
// through gcloud credentials): TUTORIAL_TTS=chirp.
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { splitSentences, pauseAfter } from './lib/speech.js';
import { CACHE_DIR, checkEpisode, episodeOutDir, PYTHON, TUTORIAL_DIR } from './lib/episode.js';
import { voiceQa } from './qa-voice.js';

const PROVIDER = process.env.TUTORIAL_TTS || 'kokoro';
const VOICE = process.env.TUTORIAL_VOICE || (PROVIDER === 'chirp' ? 'en-US-Chirp3-HD-Aoede' : 'af_heart');
const SPEED = Number(process.env.TUTORIAL_SPEED || 0.9);

function synthesizeKokoro(items, cacheDir) {
    const jobFile = path.join(cacheDir, `job-${process.pid}.json`);
    fs.writeFileSync(jobFile, JSON.stringify({ voice: VOICE, speed: SPEED, g2p: 'misaki', cacheDir, items }));
    const res = spawnSync(PYTHON, [path.join(TUTORIAL_DIR, 'voice', 'tts.py'), jobFile], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024,
    });
    fs.rmSync(jobFile, { force: true });
    if (res.status !== 0) throw new Error(`tts.py failed (exit ${res.status})`);
    return JSON.parse(res.stdout);
}

async function synthesizeChirp(items, cacheDir) {
    const token = execFileSync('gcloud', ['auth', 'print-access-token']).toString().trim();
    const project = execFileSync('gcloud', ['config', 'get-value', 'project']).toString().trim();
    const out = [];
    for (const item of items) {
        const key = crypto.createHash('sha256').update(JSON.stringify(['chirp', VOICE, SPEED, item.text])).digest('hex').slice(0, 20);
        const wav = path.join(cacheDir, `${key}.wav`);
        if (!fs.existsSync(wav)) {
            const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Goog-User-Project': project },
                body: JSON.stringify({
                    input: { text: item.text },
                    voice: { languageCode: 'en-US', name: VOICE },
                    audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, speakingRate: SPEED },
                }),
            });
            const data = await res.json();
            if (!data.audioContent) throw new Error(`chirp synthesis failed: ${JSON.stringify(data).slice(0, 200)}`);
            fs.writeFileSync(wav, Buffer.from(data.audioContent, 'base64'));
        }
        const duration = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString());
        out.push({ id: item.id, wav, duration, cached: false });
    }
    return out;
}

export async function narrateEpisode(episode, outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const cacheDir = path.join(CACHE_DIR, 'voice', `${PROVIDER}-${VOICE}-${SPEED}`);
    fs.mkdirSync(cacheDir, { recursive: true });

    const beats = episode.beats.map((beat, i) => ({
        beat: i,
        chapter: beat.chapter ?? null,
        sentences: beat.say ? splitSentences(beat.say) : [],
    }));
    const unique = new Map();
    for (const b of beats) for (const s of b.sentences) if (!unique.has(s.spoken)) unique.set(s.spoken, `s${unique.size}`);
    const items = [...unique].map(([text, id]) => ({ id, text }));
    const results = PROVIDER === 'chirp' ? await synthesizeChirp(items, cacheDir) : synthesizeKokoro(items, cacheDir);
    const byId = new Map(results.map(r => [r.id, r]));

    for (const b of beats) {
        let t = 0;
        b.sentences = b.sentences.map((s, k) => {
            const clip = byId.get(unique.get(s.spoken));
            const timed = { display: s.display, spoken: s.spoken, wav: clip.wav, start: t, duration: clip.duration };
            t += clip.duration + pauseAfter(s, k === b.sentences.length - 1);
            return timed;
        });
        const last = b.sentences[b.sentences.length - 1];
        b.duration = last ? last.start + last.duration : 0;
    }
    const narration = { provider: PROVIDER, voice: VOICE, speed: SPEED, beats };
    fs.writeFileSync(path.join(outDir, 'narration.json'), JSON.stringify(narration, null, 2));
    const total = beats.reduce((a, b) => a + b.duration, 0);
    const words = beats.reduce((a, b) => a + b.sentences.reduce((w, s) => w + s.spoken.split(/\s+/).length, 0), 0);
    console.log(`narration: ${beats.length} beats, ${unique.size} sentences, ${total.toFixed(1)}s of speech, ${Math.round(words / (total / 60))} wpm`);
    return narration;
}

if (process.argv[1]?.endsWith('narrate.js') && process.argv[2]) {
    const episode = checkEpisode(await import(path.resolve(process.argv[2])), process.argv[2]);
    const outDir = episodeOutDir(episode);
    await narrateEpisode(episode, outDir);
    // Whisper round trip: every sentence transcribed and diffed against the script
    if (!process.argv.includes('--no-qa')) voiceQa(outDir);
}
