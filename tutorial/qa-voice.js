// Whisper round trip over an episode's narration: every sentence clip is
// transcribed and diffed against what the voice was asked to say. Words the
// model swallowed or mangled show up as substitutions — fix them with a
// LEXICON entry (lib/speech.js), an inline [shown](=spoken) override, or a
// rewrite. Runs at the end of narrate.js.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PYTHON, TUTORIAL_DIR } from './lib/episode.js';

// Whisper writes numbers as digits, key names as "Ctrl", and drops hyphens;
// fold both sides to the same shape and ignore numbers entirely.
const NUMBER_WORDS = new Set(('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen '
    + 'fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand '
    + 'first second third fourth fifth sixth seventh eighth ninth tenth').split(' '));
const SPELLINGS = { ctrl: 'control', cmd: 'command', ok: 'okay', alright: 'all right' };
const normalize = (text) => text.toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[-–—/+]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(w => SPELLINGS[w] ?? w)
    .flatMap(w => w.split(' '))
    .filter(w => w && !/\d/.test(w) && !NUMBER_WORDS.has(w));
// Whisper routinely drops or inserts these; a diff made only of them is noise.
const STOPWORDS = new Set('a an the and to of in it is at on for that this'.split(' '));
const meaningful = (edit) => edit.replace(/^[-+]/, '').split('→').some(w => !STOPWORDS.has(w));

function align(ref, hyp) {
    const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...Array(hyp.length).fill(0)]);
    for (let j = 1; j <= hyp.length; j++) d[0][j] = j;
    for (let i = 1; i <= ref.length; i++) {
        for (let j = 1; j <= hyp.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
        }
    }
    const edits = [];
    let i = ref.length, j = hyp.length;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
            if (ref[i - 1] !== hyp[j - 1]) edits.push(`${ref[i - 1]}→${hyp[j - 1]}`);
            i--; j--;
        } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { edits.push(`-${ref[i - 1]}`); i--; }
        else { edits.push(`+${hyp[j - 1]}`); j--; }
    }
    return { distance: d[ref.length][hyp.length], edits: edits.reverse() };
}

export function voiceQa(outDir) {
    const narration = JSON.parse(fs.readFileSync(path.join(outDir, 'narration.json'), 'utf8'));
    const sentences = [];
    const seen = new Set();
    narration.beats.forEach(b => b.sentences.forEach(s => {
        if (!seen.has(s.wav)) { seen.add(s.wav); sentences.push({ id: `${b.beat}`, wav: s.wav, spoken: s.spoken, display: s.display }); }
    }));
    const list = path.join(outDir, 'asr-input.json');
    fs.writeFileSync(list, JSON.stringify(sentences.map((s, k) => ({ id: String(k), wav: s.wav }))));
    const res = spawnSync(PYTHON, [path.join(TUTORIAL_DIR, 'voice', 'asr.py'), list], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) throw new Error(`asr.py failed: ${res.stderr.slice(-500)}`);
    const heard = JSON.parse(res.stdout);
    const report = sentences.map((s, k) => {
        const ref = normalize(s.spoken);
        const hyp = normalize(heard[k].heard);
        const { distance, edits } = align(ref, hyp);
        return { beat: s.id, spoken: s.spoken, heard: heard[k].heard, wer: ref.length ? distance / ref.length : 0, edits: edits.filter(meaningful) };
    });
    fs.writeFileSync(path.join(outDir, 'voice-qa.json'), JSON.stringify(report, null, 2));
    const flagged = report.filter(r => r.edits.length > 0);
    const words = report.reduce((a, r) => a + normalize(r.spoken).length, 0);
    const errors = report.reduce((a, r) => a + r.wer * normalize(r.spoken).length, 0);
    console.log(`voice QA: ${report.length} sentences, overall WER ${(100 * errors / Math.max(1, words)).toFixed(1)}%, ${flagged.length} with differences`);
    for (const r of flagged) console.log(`  [beat ${r.beat}] ${r.edits.join(' ')}\n      said: ${r.spoken}\n     heard: ${r.heard}`);
    return report;
}
