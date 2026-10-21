// Records one episode: sealed servers, the 133%-zoom studio browser, the
// episode's off-camera setup, then every beat with its narration timing.
//
// Usage: node tutorial/record.js <episode-module> [--dry] [--until N] [--shots]
//   --dry    no capture, no narration waits, 4× faster pointer — a quick
//            selector check before spending a real-time recording
//   --until  stop after beat N (dry runs while authoring)
//   --shots  dry runs: screenshot after every beat to <out>/dry/beat-NN.png
// Needs <out>/narration.json from narrate.js (except --dry). Writes
// <out>/frames/ (screencast) and <out>/timeline.json for assemble.js.
// An episode may export `teardown(ctx)`: it runs off camera once every beat
// has played (e.g. saving the finished project for the next episode).
import fs from 'node:fs';
import path from 'node:path';
import { checkEpisode, episodeOutDir } from './lib/episode.js';
import { startServers } from './lib/servers.js';
import { launchStudio, ZOOM, VIDEO } from './lib/browser.js';
import { startScreencast } from './lib/screencast.js';
import { createHuman } from './lib/human.js';

const BREATH = 0.45; // seconds of quiet after each beat
const ALERT_PATTERN = /unable|error|failed|not saved|conflict|went wrong|could not/i;
const sleep = (ms) => new Promise(r => setTimeout(r, Math.max(0, ms)));
const now = () => Date.now() / 1000;

let cleanup = null;

export async function recordEpisode(episode, { dry = false, until = Infinity, shots = false } = {}) {
    const outDir = episodeOutDir(episode);
    const narration = dry ? null : JSON.parse(fs.readFileSync(path.join(outDir, 'narration.json'), 'utf8'));
    if (narration && narration.beats.length !== episode.beats.length) {
        throw new Error(`narration.json has ${narration.beats.length} beats, storyboard has ${episode.beats.length}: re-run narrate.js`);
    }
    const servers = await startServers(`${episode.meta.id}${dry ? '-dry' : ''}`, { web: 'preview' });
    const studio = await launchStudio();
    cleanup = async () => { await studio.close(); servers.stop(); };
    const { page } = studio;
    const events = [];
    const zooms = [];
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
    const human = createHuman(page, { seed: episode.meta.number ?? 1, onEvent: e => events.push(e), speed: dry ? 4 : 1 });

    const ctx = {
        page, servers, studio, human, outDir, dry, meta: episode.meta,
        baseUrl: servers.baseUrl,
        state: {},
        wait: (ms) => sleep(dry ? Math.min(ms, 150) : ms),
        async goto(pathname, { waitFor } = {}) {
            await page.goto(pathname.startsWith('http') ? pathname : servers.baseUrl + pathname);
            if (waitFor) await page.locator(waitFor).first().waitFor({ timeout: 60000 });
            human.resetDialogs();
            await human.ensure();
        },
        click: (...a) => human.click(...a),
        move: (...a) => human.move(...a),
        hover: (...a) => human.hover(...a),
        drag: (...a) => human.drag(...a),
        type: (...a) => human.type(...a),
        paste: (...a) => human.paste(...a),
        press: (...a) => human.press(...a),
        showKeys: (...a) => human.showKeys(...a),
        tool: (...a) => human.tool(...a),
        wheel: (...a) => human.wheel(...a),
        pick: (...a) => human.pick(...a),
        pickColor: (...a) => human.pickColor(...a),
        chooseFile: (...a) => human.chooseFile(...a),
        dialogs: { arm: (...a) => human.armDialogs(...a), replay: (...a) => human.replayDialogs(...a) },
        async spotlight(target, label = '', pad = 8) {
            const box = typeof target?.boundingBox === 'function' ? await target.boundingBox() : target;
            await page.evaluate(([b, l, p]) => window.__studio.spotlight(b, l, p), [box, label, pad]);
        },
        unspotlight: () => page.evaluate(() => window.__studio?.spotlightOff()),
        /** Post-production zoom onto a region (CSS px box or Locator) — applied by compose.py. */
        async zoom(target, { scale = 1.6, duration = 0.7 } = {}) {
            const box = typeof target?.boundingBox === 'function' ? await target.boundingBox() : target;
            const cx = (box.x + box.width / 2) * ZOOM, cy = (box.y + box.height / 2) * ZOOM;
            zooms.push({ t: now(), scale, cx, cy, duration });
        },
        unzoom: ({ duration = 0.7 } = {}) => { zooms.push({ t: now(), scale: 1, cx: VIDEO.width / 2, cy: VIDEO.height / 2, duration }); },
        titleCard: (extra = {}) => page.evaluate(c => window.__studio.card(c), {
            kicker: `Episode ${String(episode.meta.number).padStart(2, '0')} · ${episode.meta.level}`,
            title: episode.meta.title, subtitle: episode.meta.summary, chips: episode.meta.chips ?? [], ...extra,
        }),
        endCard: (extra = {}) => page.evaluate(c => window.__studio.card(c), {
            kicker: episode.meta.next ? `Up next · Episode ${String(episode.meta.next.number).padStart(2, '0')}` : 'Thanks for watching',
            title: episode.meta.next?.title ?? 'That’s the series',
            subtitle: episode.meta.next?.summary ?? '', chips: episode.meta.docs ?? [], ...extra,
        }),
        cardOut: (ms = 700) => page.evaluate(m => window.__studio.cardOut(m), ms),
        lowerThird: (kicker, title) => page.evaluate(([k, t]) => window.__studio.lowerThird(k, t), [kicker, title]),
        /** Runs `trigger`, saves the download into <out>/downloads, shows the download bubble. */
        async download(trigger, { timeout = 180000 } = {}) {
            const pending = page.waitForEvent('download', { timeout });
            await trigger();
            const d = await pending;
            const dir = path.join(outDir, 'downloads');
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, d.suggestedFilename());
            await d.saveAs(file);
            await page.evaluate(n => window.__studio?.toast(n), d.suggestedFilename()).catch(() => {});
            return file;
        },
        /** Opens a local PDF in the tutorial reader page. */
        async openPdf(file, { title } = {}) {
            const name = path.basename(file);
            studio.serveFile(name, file);
            await ctx.goto(`/__tutorial/viewer/?file=${encodeURIComponent(name)}&title=${encodeURIComponent(title ?? name)}`);
            await page.waitForFunction(() => window.__viewer?.state.ready, null, { timeout: 120000 });
        },
        /**
         * Clicks a link in the PDF reader — by the text it covers ({ text, nth }) or by position
         * as page fractions ({ near: [fx, fy] }) — and waits for the jump to land.
         */
        async clickPdfLink({ text, nth = 0, near }) {
            const rect = await page.evaluate(([t, n, nr]) => (nr ? window.__viewer.linkNear(nr[0], nr[1]) : window.__viewer.linkFor(t, n)), [text, nth, near]);
            if (!rect) throw new Error(`no PDF link for ${text ?? near}`);
            const before = await page.evaluate(() => window.__viewer.state.jumps);
            await human.click(rect);
            await page.waitForFunction(b => window.__viewer.state.jumps > b, before, { timeout: 10000 });
            await page.waitForTimeout(500);
            return page.evaluate(() => window.__viewer.state.page);
        },
        /** Scrolls the PDF reader on by one page with the mouse wheel. */
        async pdfNextPage({ steps = 12 } = {}) {
            const step = await page.evaluate(() => window.__viewer.pageStep());
            // wheel deltas are screen pixels; the reader scrolls them divided by the page zoom
            await human.wheel(step * ZOOM, { at: { x: 720 + human.rnd() * 40, y: 450 }, steps });
        },
        /**
         * Inside a beat's `do`: waits until sentence k of the beat's narration starts
         * (or ends, with { end: true }), plus `offset` seconds. A no-op in dry runs.
         */
        async atSentence(k, { end = false, offset = 0 } = {}) {
            const b = ctx.beat;
            const s = b?.sentences?.[k];
            if (dry || !b || b.narrationStart === null || !s) return;
            await sleep((b.narrationStart + s.start + (end ? s.duration : 0) + offset - now()) * 1000);
        },
        beat: null,
    };

    // Warm caches (bundle, fonts) off camera, then start from a clean origin.
    for (const p of ['/', '/app', '/gallery', '/docs']) {
        await page.goto(servers.baseUrl + p);
        await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    }
    await page.locator('[data-testid="editor-canvas"]').first().waitFor({ timeout: 60000 }).catch(() => {});
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Storage.clearDataForOrigin', { origin: servers.baseUrl, storageTypes: 'indexeddb,local_storage,session_storage' });
    await cdp.detach();
    await page.goto('about:blank');
    if (episode.setup) await episode.setup(ctx);
    await human.ensure();

    const timeline = { episode: episode.meta.id, video: VIDEO, zoom: ZOOM, beats: [], events, zooms, pageErrors };
    const capture = dry ? null : await startScreencast(page, path.join(outDir, 'frames'));
    const t0 = now();
    timeline.t0 = t0;
    let chapterNo = 0;
    let finished = false;
    try {
        for (let i = 0; i < episode.beats.length && i <= until; i++) {
            const beat = episode.beats[i];
            const nb = narration?.beats[i] ?? { duration: 0, sentences: [] };
            const beatStart = now();
            if (beat.chapter) {
                chapterNo++;
                if (beat.lowerThird !== false && chapterNo > 1) await ctx.lowerThird(`Chapter ${chapterNo}`, beat.chapter);
            }
            process.stdout.write(`beat ${i}${beat.chapter ? ` [${beat.chapter}]` : ''} @ ${(beatStart - t0).toFixed(1)}s\n`);

            let narrationStart = beatStart;
            ctx.beat = { index: i, narrationStart: beat.at === 'before' ? null : beatStart, sentences: nb.sentences };
            const run = async () => {
                try {
                    if (beat.do) await beat.do(page, ctx);
                } catch (err) {
                    await page.screenshot({ path: path.join(outDir, `failure-beat-${i}.png`) }).catch(() => {});
                    throw new Error(`beat ${i} failed: ${err.message}`);
                }
            };
            if (beat.at === 'before') {
                await run();
                narrationStart = now();
            } else {
                const at = beat.at;
                const offset = dry || at === undefined ? 0
                    : Number.isInteger(at) ? (nb.sentences[at]?.start ?? 0)
                        : at === 'end' ? nb.duration : parseFloat(at);
                await sleep((narrationStart + offset - now()) * 1000);
                await run();
            }
            if (!dry) await sleep((narrationStart + nb.duration - now()) * 1000);
            await sleep((dry ? 0.05 : beat.hold ?? BREATH) * 1000);
            timeline.beats.push({ beat: i, chapter: beat.chapter ?? null, start: beatStart - t0, narrationStart: narrationStart - t0, end: now() - t0 });
            if (dry && shots) {
                fs.mkdirSync(path.join(outDir, 'dry'), { recursive: true });
                await page.screenshot({ path: path.join(outDir, 'dry', `beat-${String(i).padStart(2, '0')}.png`) });
            }

            if (!beat.allowAlert) {
                const alerts = await page.locator('[role="alert"]').allTextContents().catch(() => []);
                const bad = alerts.filter(a => ALERT_PATTERN.test(a));
                if (bad.length) {
                    await page.screenshot({ path: path.join(outDir, `failure-beat-${i}.png`) }).catch(() => {});
                    throw new Error(`beat ${i}: app shows an error: ${bad.join(' | ').slice(0, 300)}`);
                }
            }
        }
        await sleep(dry ? 0 : 1200);
        finished = until >= episode.beats.length - 1;
    } finally {
        timeline.end = now() - t0;
        if (capture) {
            await capture.stop();
            timeline.frames = capture.frames;
        }
        fs.writeFileSync(path.join(outDir, dry ? 'timeline-dry.json' : 'timeline.json'), JSON.stringify(timeline, null, 2));
        if (!finished) {
            await cleanup?.();
            cleanup = null;
        }
    }
    try {
        if (episode.teardown) await episode.teardown(ctx);
    } finally {
        await cleanup?.();
        cleanup = null;
    }
    if (pageErrors.length) console.warn(`page errors during recording:\n  ${pageErrors.join('\n  ')}`);
    console.log(`${dry ? 'dry run' : 'recorded'}: ${timeline.end.toFixed(1)}s${capture ? `, ${timeline.frames} frames` : ''}`);
    return timeline;
}

if (process.argv[1]?.endsWith('record.js') && process.argv[2]) {
    const args = process.argv.slice(3);
    const flag = (name) => args.includes(name);
    const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.on(sig, async () => { console.error(`\n✗ ${sig}: stopping servers`); await cleanup?.(); process.exit(130); });
    }
    const episode = checkEpisode(await import(path.resolve(process.argv[2])), process.argv[2]);
    try {
        await recordEpisode(episode, { dry: flag('--dry'), shots: flag('--shots'), until: value('--until') !== undefined ? Number(value('--until')) : Infinity });
    } catch (err) {
        console.error(`✗ ${err.message}`);
        await cleanup?.();
        process.exit(1);
    }
}
