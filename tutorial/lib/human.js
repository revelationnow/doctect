// Human-paced input. Movement follows an eased, slightly curved path whose
// duration grows with distance (roughly Fitts' law); clicks land near — not
// exactly on — an element's centre; typing has uneven rhythm. A seeded PRNG
// keeps every render of an episode identical.
//
// Native browser UI that headless Chromium never paints (<select> lists,
// prompt/confirm/alert, colour pickers, file pickers) is acted out on the
// studio overlay — see lib/overlay.js — while the real value is set through
// Playwright, so the app sees exactly what a user's choice would produce.
import { installStudio } from './overlay.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const KEY_LABELS = {
    Control: 'Ctrl', Meta: 'Cmd', Alt: 'Alt', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Backspace: 'Backspace', Delete: 'Delete', Enter: 'Enter', Tab: 'Tab', ' ': 'Space', Space: 'Space',
};
const keyParts = (combo) => combo.split('+').map(k => KEY_LABELS[k] ?? (k.length === 1 ? k.toUpperCase() : k));

export function createHuman(page, { seed = 1, onEvent = () => {}, speed = 1 } = {}) {
    const rnd = mulberry32(seed);
    const jitter = (amount) => (rnd() - 0.5) * 2 * amount;
    let pos = { x: 720, y: 405 };
    const now = () => Date.now() / 1000;
    const event = (type, extra = {}) => onEvent({ type, t: now(), ...extra });
    const showKeys = (parts, label = '') => page.evaluate(a => window.__studio?.keys(a.parts, a.label), { parts, label });

    async function ensure() {
        await page.evaluate(installStudio).catch(() => {});
        await page.evaluate(([x, y]) => window.__studio?.move(x, y), [pos.x, pos.y]).catch(() => {});
    }

    /** A point from a Locator, a selector, a {x,y,width,height} box, or a {x,y} point. */
    async function pointOf(target, { ax = 0.5, ay = 0.5, exact = false } = {}) {
        let box;
        if (typeof target === 'string') target = page.locator(target).first();
        if (typeof target?.boundingBox === 'function') {
            await target.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
            box = await target.boundingBox({ timeout: 10000 });
            if (!box) throw new Error(`human: no bounding box for ${target}`);
        } else if (typeof target?.width === 'number') {
            box = target;
        } else if (typeof target?.x === 'number') {
            return target;
        } else {
            throw new Error(`human: unsupported target ${JSON.stringify(target)}`);
        }
        const jx = exact ? 0 : jitter(Math.min(6, box.width * 0.12));
        const jy = exact ? 0 : jitter(Math.min(3, box.height * 0.12));
        return { x: box.x + box.width * ax + jx, y: box.y + box.height * ay + jy };
    }

    async function move(target, opts = {}) {
        const to = await pointOf(target, opts);
        const from = { ...pos };
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        if (dist < 1) return to;
        const ms = (opts.duration ?? Math.min(1050, Math.max(240, 210 + 230 * Math.log2(1 + dist / 45)))) / speed;
        // a gentle arc: one control point pushed sideways off the straight line
        const bend = jitter(Math.min(60, dist * 0.12));
        const nx = -(to.y - from.y) / dist, ny = (to.x - from.x) / dist;
        const c = { x: (from.x + to.x) / 2 + nx * bend, y: (from.y + to.y) / 2 + ny * bend };
        const steps = Math.max(8, Math.round(ms / 16));
        const start = Date.now();
        for (let i = 1; i <= steps; i++) {
            const t = easeInOut(i / steps);
            const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * c.x + t * t * to.x;
            const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * c.y + t * t * to.y;
            await page.mouse.move(x, y);
            const lag = start + (ms * i) / steps - Date.now();
            if (lag > 0) await sleep(lag);
        }
        pos = to;
        return to;
    }

    /** `hold` keeps a modifier down for the click (e.g. 'Alt', 'Control', 'Shift'), with a key chip. */
    async function click(target, opts = {}) {
        await move(target, opts);
        if (opts.hold) {
            await showKeys([KEY_LABELS[opts.hold] ?? opts.hold, '+', 'Click'], opts.holdLabel ?? '');
            await page.keyboard.down(opts.hold);
        }
        await sleep((opts.dwell ?? 110 + rnd() * 120) / speed);
        const button = opts.button ?? 'left';
        await page.mouse.down({ button });
        event('click');
        await sleep(55 + rnd() * 45);
        await page.mouse.up({ button });
        if (opts.hold) await page.keyboard.up(opts.hold);
        if (opts.count === 2) {
            await sleep(70);
            await page.mouse.down({ button, clickCount: 2 });
            event('click');
            await sleep(50);
            await page.mouse.up({ button, clickCount: 2 });
        }
        await sleep((opts.after ?? 180) / speed);
    }

    /** A click acted out on the overlay only — nothing reaches the page. */
    async function fakeClick(point, { dwell = 140 } = {}) {
        await move(point, { exact: true });
        await sleep(dwell / speed);
        await page.evaluate(() => { window.__studio.down(); window.__studio.ripple(); });
        event('click');
        await sleep(80);
        await page.evaluate(() => window.__studio.up());
        await sleep(120 / speed);
    }

    /** Press, travel, release. `hold` keeps a modifier down throughout (e.g. 'Shift', 'Control'). */
    async function drag(from, to, opts = {}) {
        await move(from, opts.fromOpts ?? {});
        await sleep(120 / speed);
        if (opts.hold) {
            await showKeys([KEY_LABELS[opts.hold] ?? opts.hold], opts.holdLabel ?? '');
            await page.keyboard.down(opts.hold);
            await sleep(150 / speed);
        }
        await page.mouse.down();
        event('click');
        await sleep(90 / speed);
        await move(to, { duration: opts.duration ?? 700, ...(opts.toOpts ?? {}) });
        await sleep(90 / speed);
        await page.mouse.up();
        if (opts.hold) await page.keyboard.up(opts.hold);
        await sleep(160 / speed);
    }

    async function type(text, { wpm = 230, keyChips = false } = {}) {
        const base = 60000 / (wpm * 5);
        for (const ch of text) {
            await page.keyboard.type(ch);
            event('key');
            let d = base * (0.55 + rnd() * 0.9);
            if (ch === ' ') d *= 1.25;
            if (/[.,:;!?]/.test(ch)) d *= 2.2;
            if (rnd() < 0.04) d += 160; // the occasional hesitation
            await sleep(d / speed);
            if (keyChips) await showKeys([ch]);
        }
    }

    /** Pastes a block as if from the clipboard (shows Ctrl+V). */
    async function paste(text) {
        await showKeys(['Ctrl', '+', 'V']);
        event('key');
        await page.keyboard.insertText(text);
    }

    async function press(combo, { chip = true, label = '' } = {}) {
        if (chip) await showKeys(keyParts(combo).flatMap((p, i) => (i ? ['+', p] : [p])), label);
        event('key');
        await page.keyboard.press(combo);
        await sleep(160 / speed);
    }

    async function wheel(dy, { at, steps = 6, ctrl = false, dx = 0 } = {}) {
        if (at) await move(at);
        if (ctrl) {
            await showKeys(['Ctrl', '+', 'Scroll']);
            await page.keyboard.down('Control');
        }
        for (let i = 0; i < steps; i++) {
            await page.mouse.wheel(dx / steps, dy / steps);
            await sleep(45);
        }
        if (ctrl) await page.keyboard.up('Control');
        await sleep(200);
    }

    async function hover(target, ms = 600) {
        await move(target);
        await sleep(ms / speed);
    }

    /** Choose from a native <select> by label (or value), acted out on the overlay. */
    async function pick(select, choice, { dwell = 380 } = {}) {
        const loc = typeof select === 'string' ? page.locator(select).first() : select;
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        const box = await loc.boundingBox();
        const options = await loc.evaluate(sel => [...sel.options].map(o => ({
            label: o.label || o.text, value: o.value, disabled: o.disabled,
            group: o.parentElement?.tagName === 'OPTGROUP' ? o.parentElement.label : null,
            selected: o.selected,
        })));
        const items = [];
        let lastGroup = null;
        for (const o of options) {
            if (o.group && o.group !== lastGroup) { items.push({ label: o.group, group: true }); lastGroup = o.group; }
            items.push({ label: o.label, inGroup: !!o.group, disabled: o.disabled, value: o.value, selected: o.selected });
        }
        const targetIndex = items.findIndex(it => !it.group && (it.label === choice || it.value === choice));
        if (targetIndex < 0) throw new Error(`pick: no option "${choice}" in ${options.map(o => o.label).join(', ')}`);
        const current = Math.max(0, items.findIndex(it => it.selected));
        await fakeClick(await pointOf(box, { ax: 0.5 }));
        await page.evaluate(([b, its, cur]) => { window.__studio.lockShape('arrow'); window.__studio.dropdown(b, its, cur); }, [box, items, current]);
        await sleep(dwell / speed);
        await page.evaluate(i => window.__studio.dropdownHighlight(i), targetIndex);
        const rect = (await page.evaluate(() => window.__studio.dropdownRects()))[targetIndex];
        await page.evaluate(i => window.__studio.dropdownHighlight(i), current);
        await move({ x: rect.x + Math.min(rect.width / 2, 60) + jitter(8), y: rect.y + rect.height / 2 });
        await page.evaluate(i => window.__studio.dropdownHighlight(i), targetIndex);
        await sleep(150 / speed);
        await fakeClick({ x: pos.x, y: pos.y }, { dwell: 60 });
        await page.evaluate(() => { window.__studio.dropdownClose(); window.__studio.lockShape(null); });
        await loc.selectOption(items[targetIndex].value);
        await sleep(220 / speed);
    }

    /** Set an <input type=color>, acted out as a small swatch palette. */
    async function pickColor(input, hex, palette) {
        const loc = typeof input === 'string' ? page.locator(input).first() : input;
        const box = await loc.boundingBox();
        const colors = palette ?? ['#0f172a', '#334155', '#64748b', '#cbd5e1', '#ffffff', '#fef3c7',
            '#b91c1c', '#ea580c', '#ca8a04', '#15803d', '#2563eb', '#7c3aed'];
        const list = colors.includes(hex) ? colors : [...colors.slice(0, colors.length - 1), hex];
        await fakeClick(await pointOf(box));
        await page.evaluate(([b, c]) => { window.__studio.lockShape('arrow'); window.__studio.palette(b, c); }, [box, list]);
        await sleep(350 / speed);
        const rects = await page.evaluate(() => window.__studio.paletteRects());
        const r = rects[list.indexOf(hex)];
        await move({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
        await page.evaluate(i => window.__studio.paletteHighlight(i), list.indexOf(hex));
        await fakeClick({ x: pos.x, y: pos.y }, { dwell: 80 });
        await page.evaluate(() => { window.__studio.paletteClose(); window.__studio.lockShape(null); });
        await loc.fill(hex);
        // a real picker closing hands focus back to the page; leaving it in the
        // input would swallow the next single-key tool shortcut
        await loc.evaluate(el => el.blur());
        await sleep(200 / speed);
    }

    /** A canvas tool shortcut (V, T, R…), first stepping out of any focused field. */
    async function tool(key) {
        await page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
        await press(key);
    }

    /**
     * Answers for the app's next prompt/confirm/alert calls. Arm before the
     * click that opens them; replayDialogs() then acts them out on screen.
     */
    let replayed = 0;
    async function armDialogs(...answers) {
        await page.evaluate(a => { window.__studioDialogs.queue.push(...a); }, answers);
    }
    async function replayDialogs({ typeWpm = 180 } = {}) {
        const log = await page.evaluate(() => window.__studioDialogs?.log ?? []);
        const fresh = log.slice(replayed);
        replayed = log.length;
        for (const d of fresh) {
            const answer = d.answer || {};
            const ok = await page.evaluate(x => { window.__studio.lockShape('arrow'); return window.__studio.dialog(x); },
                { type: d.type, message: d.message, text: d.type === 'prompt' ? (d.defaultValue ?? '') : '' });
            await sleep(650 / speed);
            if (d.type === 'prompt' && answer.text !== undefined && answer.text !== d.defaultValue) {
                let shown = '';
                await page.evaluate(() => window.__studio.dialogText(''));
                for (const ch of answer.text) {
                    shown += ch;
                    await page.evaluate(t => window.__studio.dialogText(t), shown);
                    event('key');
                    await sleep((60000 / (typeWpm * 5)) * (0.6 + rnd() * 0.8) / speed);
                }
                await sleep(300 / speed);
            }
            await fakeClick({ x: ok.x + ok.width / 2, y: ok.y + ok.height / 2 });
            await page.evaluate(() => { window.__studio.dialogClose(); window.__studio.lockShape(null); });
            await sleep(250 / speed);
        }
        return fresh;
    }
    /** Resets the replay cursor after a navigation (each document has its own log). */
    const resetDialogs = () => { replayed = 0; };

    /** Pick a file through an <input type=file>, acted out as a file dialog. */
    async function chooseFile(trigger, filePath) {
        const name = filePath.split('/').pop();
        const chooserPromise = page.waitForEvent('filechooser');
        await (typeof trigger === 'function' ? trigger() : click(trigger));
        const chooser = await chooserPromise;
        const { rows, open } = await page.evaluate(n => { window.__studio.lockShape('arrow'); return window.__studio.filePicker([n]); }, name);
        await sleep(500 / speed);
        await move({ x: rows[0].x + 140, y: rows[0].y + rows[0].height / 2 });
        await page.evaluate(() => window.__studio.filePickerHighlight(0));
        await fakeClick({ x: pos.x, y: pos.y }, { dwell: 80 });
        await fakeClick({ x: open.x + open.width / 2, y: open.y + open.height / 2 });
        await page.evaluate(() => { window.__studio.filePickerClose(); window.__studio.lockShape(null); });
        await chooser.setFiles(filePath);
        await sleep(300 / speed);
    }

    return {
        ensure, pointOf, move, click, fakeClick, drag, type, paste, press, tool, wheel, hover, pick, pickColor, showKeys,
        armDialogs, replayDialogs, resetDialogs, chooseFile,
        get pos() { return pos; },
        set pos(p) { pos = p; },
        rnd,
    };
}
