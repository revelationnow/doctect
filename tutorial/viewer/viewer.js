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

window.__viewer = {
    get state() { return { ...state, pages: doc.numPages }; },
    goToPage(n) { viewer.currentPageNumber = n; },
    /** Link rectangles on the current page, with their target page when internal. */
    async links() {
        const pageView = viewer.getPageView(viewer.currentPageNumber - 1);
        const anchors = [...(pageView?.div.querySelectorAll('.annotationLayer .linkAnnotation > a') || [])];
        return anchors.map(a => {
            const r = a.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, href: a.getAttribute('href') };
        });
    },
};
await new Promise(r => eventBus.on('pagerendered', r, { once: true }));
state.ready = true;
