// Minimal pdf.js reader with working internal links. Exposes window.__viewer
// so storyboards can find link areas on the visible page and wait for jumps.
// pdf.mjs publishes globalThis.pdfjsLib as it evaluates, which pdf_viewer.mjs
// (imported after it, so evaluated after it) reads.
import * as pdfjsLib from '/__tutorial/pdfjs/pdf.mjs';
import { EventBus, PDFLinkService, PDFViewer } from '/__tutorial/pdfjs/pdf_viewer.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/__tutorial/pdfjs/pdf.worker.mjs';

const params = new URLSearchParams(location.search);
const file = params.get('file');
const scale = params.get('scale') || 'page-fit';
document.getElementById('name').textContent = params.get('title') || file;

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const viewer = new PDFViewer({ container: document.getElementById('viewerContainer'), eventBus, linkService });
linkService.setViewer(viewer);

const state = { ready: false, page: 1, jumps: 0 };
eventBus.on('pagesinit', () => { viewer.currentScaleValue = scale; });
eventBus.on('pagechanging', (e) => {
    state.page = e.pageNumber;
    document.getElementById('cur').textContent = e.pageNumber.toLocaleString('en-US');
});
eventBus.on('scalechanging', (e) => {
    document.getElementById('zoom').textContent = `${Math.round(e.scale * 100)}%`;
});
// pdf.js reports internal-link navigation through the link service
const navigateTo = linkService.goToDestination.bind(linkService);
linkService.goToDestination = async (dest) => { state.jumps++; return navigateTo(dest); };

const doc = await pdfjsLib.getDocument({
    url: `/__tutorial/files/${encodeURIComponent(file)}`,
    standardFontDataUrl: '/__tutorial/pdfjs/standard_fonts/',
}).promise;
viewer.setDocument(doc);
linkService.setDocument(doc);
document.getElementById('total').textContent = doc.numPages.toLocaleString('en-US');

const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
const currentPageDiv = () => viewer.getPageView(viewer.currentPageNumber - 1)?.div;
const anchorsOnPage = () => [...(currentPageDiv()?.querySelectorAll('.annotationLayer .linkAnnotation > a') || [])];

window.__viewer = {
    get state() { return { ...state, pages: doc.numPages }; },
    goToPage(n) { viewer.currentPageNumber = n; },
    /** Scroll distance from one page's top to the next, for paging with the wheel. */
    pageStep() {
        const [a, b] = [0, 1].map(i => viewer.getPageView(i)?.div);
        return a && b ? b.offsetTop - a.offsetTop : (a?.offsetHeight ?? 0);
    },
    /** Link rectangles on the current page. */
    links() { return anchorsOnPage().map(a => ({ ...rectOf(a), href: a.getAttribute('href') })); },
    /** The nth link on the current page covering text that reads exactly `text`. */
    linkFor(text, nth = 0) {
        const spans = [...(currentPageDiv()?.querySelectorAll('.textLayer span') || [])].filter(s => s.textContent.trim() === text);
        const anchors = anchorsOnPage().map(rectOf);
        const hits = [];
        for (const s of spans) {
            const r = rectOf(s);
            const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
            const a = anchors.find(b => cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height);
            if (a) hits.push(a);
        }
        return hits[nth] ?? null;
    },
    /** The link closest to a point given as fractions of the current page's width and height. */
    linkNear(fx, fy) {
        const page = currentPageDiv();
        if (!page) return null;
        const p = rectOf(page);
        const x = p.x + p.width * fx, y = p.y + p.height * fy;
        const dist = (b) => Math.hypot(Math.max(b.x - x, 0, x - b.x - b.width), Math.max(b.y - y, 0, y - b.y - b.height));
        return anchorsOnPage().map(rectOf).sort((a, b) => dist(a) - dist(b))[0] ?? null;
    },
};
await new Promise(r => eventBus.on('textlayerrendered', r, { once: true }));
state.ready = true;
