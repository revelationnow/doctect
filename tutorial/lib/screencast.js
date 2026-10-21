// Captures the page as timestamped JPEG frames through the CDP screencast.
// Chromium only emits a frame when something on screen changed, so idle
// stretches cost nothing; compose.py later resamples to a constant 30 fps.
// Output: <dir>/NNNNNN.jpg and <dir>/frames.jsonl ({ file, t } per line,
// t in wall-clock seconds, the same clock the recorder's timeline uses).
import fs from 'node:fs';
import path from 'node:path';
import { VIDEO } from './browser.js';

export async function startScreencast(page, dir, { quality = 92 } = {}) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const cdp = await page.context().newCDPSession(page);
    const index = fs.createWriteStream(path.join(dir, 'frames.jsonl'));
    const writes = new Set();
    let count = 0;
    let lastT = 0;

    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
        // metadata.timestamp is the compositor's frame time; never let it run backwards
        const t = Math.max(lastT, metadata.timestamp ?? Date.now() / 1000);
        lastT = t;
        const file = `${String(count++).padStart(6, '0')}.jpg`;
        const w = fs.promises.writeFile(path.join(dir, file), Buffer.from(data, 'base64'));
        writes.add(w);
        w.finally(() => writes.delete(w));
        index.write(JSON.stringify({ file, t }) + '\n');
    });
    await cdp.send('Page.startScreencast', {
        format: 'jpeg', quality, maxWidth: VIDEO.width, maxHeight: VIDEO.height, everyNthFrame: 1,
    });

    return {
        get frames() { return count; },
        async stop() {
            await cdp.send('Page.stopScreencast').catch(() => {});
            await Promise.all([...writes]);
            await new Promise(r => index.end(r));
            await cdp.detach().catch(() => {});
        },
    };
}
