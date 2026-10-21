// 1280×720 episode thumbnail: the episode's own screen (a captured frame)
// beside its number and a short headline, on the series' dark brand ground.
import { chromium } from 'playwright';
import fs from 'node:fs';

const CHROMIUM = process.env.TUTORIAL_CHROMIUM
    || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function renderThumbnail({ meta, frameFile, out }) {
    const frame = fs.readFileSync(frameFile).toString('base64');
    const headline = meta.thumbnail?.headline ?? meta.title;
    const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; font-family: Inter, sans-serif; }
  body { background: radial-gradient(900px 500px at 10% 0%, rgba(37,99,235,.45), transparent 60%),
         radial-gradient(700px 500px at 100% 100%, rgba(99,102,241,.35), transparent 60%), #0b1220; color: #fff; position: relative; }
  .shot { position: absolute; right: -70px; top: 92px; width: 860px; border-radius: 16px; overflow: hidden;
          box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); transform: perspective(1600px) rotateY(-9deg); }
  .shot img { display: block; width: 100%; }
  .text { position: absolute; left: 56px; top: 64px; width: 560px; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 700; color: #cbd5e1; }
  .brand svg { width: 40px; height: 40px; }
  .ep { margin-top: 64px; font-size: 26px; font-weight: 800; letter-spacing: .12em; color: #93c5fd; text-transform: uppercase; }
  h1 { margin: 14px 0 0; font-size: 70px; line-height: 1.02; font-weight: 800; letter-spacing: -.03em; text-shadow: 0 4px 24px rgba(0,0,0,.5); }
  .level { position: absolute; left: 56px; bottom: 52px; font-size: 22px; font-weight: 700; color: #0b1220; background: #fbbf24;
           padding: 8px 16px; border-radius: 10px; }
</style></head><body>
  <div class="shot"><img src="data:image/jpeg;base64,${frame}"></div>
  <div class="text">
    <div class="brand"><svg viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2563eb"/><g transform="translate(4 4)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></g></svg>PDF Architect</div>
    <div class="ep">Episode ${esc(meta.number)}</div>
    <h1>${esc(headline)}</h1>
  </div>
  <div class="level">${esc(meta.level)}</div>
</body></html>`;
    const browser = await chromium.launch({ executablePath: CHROMIUM });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        await page.setContent(html, { waitUntil: 'networkidle' });
        await page.screenshot({ path: out });
    } finally {
        await browser.close();
    }
}
