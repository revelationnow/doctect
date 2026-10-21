// Turns a beat's `say` text into timed sentences.
//
// `say` is written for captions; two layers turn it into what the voice reads:
//   - inline overrides, `[shown](=spoken)`: the caption shows `shown`, the voice
//     reads `spoken` — e.g. `[{{title}}](=title in double curly braces)`;
//   - LEXICON, below, for recurring words the G2P gets wrong.
// A blank line inside `say` marks a paragraph break (a longer pause).
import crypto from 'node:crypto';

// [pattern, spoken] pairs, applied in order to the spoken text only.
export const LEXICON = [
    [/\breMarkable\b/g, 'remarkable'],
    [/\bCtrl\s*\+\s*Shift\s*\+\s*(\w)\b/g, 'control shift $1'],
    [/\bCtrl\s*\+\s*(\w+)\b/g, 'control $1'],
    [/\bCmd\s*\+\s*(\w+)\b/g, 'command $1'],
    [/\bShift\s*\+\s*(\w+)\b/g, 'shift $1'],
    [/\bAlt\s*\+\s*(\w+)\b/g, 'alt $1'],
    [/\bCtrl\b/g, 'control'],
    [/\b2025\b/g, 'twenty twenty-five'],
    [/\b2026\b/g, 'twenty twenty-six'],
    [/\b2027\b/g, 'twenty twenty-seven'],
    [/(\d)\s?×\s?(\d)/g, '$1 by $2'],
    [/\s?→\s?/g, ' to '],
    [/\s&\s/g, ' and '],
    [/\be\.g\.,?/g, 'for example,'],
    [/\bi\.e\.,?/g, 'that is,'],
    [/\bvs\.?\b/g, 'versus'],
    [/(\d+(?:\.\d+)?)\s?pt\b/g, '$1 points'],
    [/(\d+(?:\.\d+)?)\s?mm\b/g, '$1 millimeters'],
    [/(\d+(?:\.\d+)?)\s?px\b/g, '$1 pixels'],
    [/(\d+(?:\.\d+)?)\s?%/g, '$1 percent'],
    [/\bUI\b/g, 'U I'],
];

const OVERRIDE = /\[([^\]]*)\]\(=([^)]*)\)/g;

/** Caption text: overrides collapse to what they show. */
export const displayText = (text) => text.replace(OVERRIDE, '$1');

/** Voice text: overrides collapse to what they say, then the lexicon applies. */
export function spokenText(text) {
    let out = text.replace(OVERRIDE, '$2');
    for (const [pattern, spoken] of LEXICON) out = out.replace(pattern, spoken);
    // typographic leftovers that only matter on screen
    return out.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * Splits on sentence-final punctuation followed by whitespace and an
 * uppercase/quote/digit start, never inside an override's brackets.
 * Returns [{ raw, paragraphEnd }].
 */
export function splitSentences(say) {
    const sentences = [];
    const paragraphs = say.trim().split(/\n\s*\n/);
    for (const para of paragraphs) {
        const text = para.replace(/\s*\n\s*/g, ' ').trim();
        let depth = 0;
        let start = 0;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (c === '[' || c === '(') depth++;
            else if ((c === ']' || c === ')') && depth > 0) depth--;
            else if (depth === 0 && /[.!?…]/.test(c)) {
                // swallow closing quotes/brackets glued to the punctuation
                let j = i + 1;
                while (j < text.length && /["'”’)]/.test(text[j])) j++;
                if (j >= text.length) continue;
                if (/\s/.test(text[j]) && /["'“‘(\[A-Z0-9]/.test(text.slice(j).trimStart()[0] || '')) {
                    sentences.push({ raw: text.slice(start, j).trim(), paragraphEnd: false });
                    start = j;
                }
            }
        }
        const tail = text.slice(start).trim();
        if (tail) sentences.push({ raw: tail, paragraphEnd: false });
        if (sentences.length) sentences[sentences.length - 1].paragraphEnd = true;
    }
    return sentences.map(s => ({ ...s, display: displayText(s.raw), spoken: spokenText(s.raw) }));
}

/** Deterministic 0..1 from a string, so re-renders keep identical pacing. */
const unit = (s) => crypto.createHash('sha1').update(s).digest().readUInt32BE(0) / 0xffffffff;

/** Silence after a sentence, in seconds: punctuation-aware, lightly varied. */
export function pauseAfter(sentence, isLastInBeat) {
    if (isLastInBeat) return 0;
    if (sentence.paragraphEnd) return 0.72 + unit(sentence.spoken) * 0.12;
    const end = sentence.display.trim().slice(-1);
    const base = end === '?' ? 0.42 : end === ':' ? 0.3 : end === '!' ? 0.36 : 0.34;
    return base + (unit(sentence.spoken) - 0.5) * 0.12;
}
