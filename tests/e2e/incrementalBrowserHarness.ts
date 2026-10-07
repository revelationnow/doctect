import { expect, type Page } from '@playwright/test';
import type { WorkspaceProject } from '../../services/localWorkspace/contracts';

type Entry = { entryType: string; startTime: number; duration: number; processingStart?: number; processingEnd?: number; interactionId?: number };
type Observations = { supportedEntryTypes: string[]; entries: Entry[] };
const observations = new WeakMap<Page, Observations>();
const metadata = new WeakMap<Page, Pick<WorkspaceProject, 'id' | 'name'>>();

export async function observeIncrementalPerformance(page: Page): Promise<void> {
  const captured: Observations = { supportedEntryTypes: [], entries: [] };
  observations.set(page, captured);
  // Test-context binding, not an application debug object. Export only timing
  // numbers/types, never event targets, document text, IDs or worker payloads.
  await page.exposeBinding('__incrementalTimingSink', (_source, message) => {
    if (message.supportedEntryTypes) captured.supportedEntryTypes = message.supportedEntryTypes;
    if (message.entries) captured.entries.push(...message.entries);
  });
  await page.addInitScript(() => {
    const sink = (globalThis as any).__incrementalTimingSink;
    const supportedEntryTypes = PerformanceObserver.supportedEntryTypes;
    void sink({ supportedEntryTypes });
    for (const type of ['longtask', 'event']) {
      if (!supportedEntryTypes.includes(type)) continue;
      new PerformanceObserver(list => {
        void sink({ entries: list.getEntries().map(entry => {
          // Experimental browser field, absent on implementations without it.
          // Keep absence as undefined; never manufacture an interaction ID.
          const event = entry as PerformanceEventTiming & { interactionId?: number };
          return { entryType: entry.entryType, startTime: entry.startTime, duration: entry.duration,
            ...(type === 'event' ? { processingStart: event.processingStart, processingEnd: event.processingEnd, interactionId: event.interactionId } : {}) };
        }) });
      }).observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
    }
  });
}

export function readIncrementalObservations(page: Page): Observations {
  const result = observations.get(page);
  if (!result) throw new Error('Performance observer not installed');
  return structuredClone(result);
}

export async function assertIncrementalSaveHealthy(page: Page): Promise<void> {
  const statuses = await page.getByRole('alert').allTextContents();
  expect(statuses.join('\n'), 'Real baseline save failure, not a missing Saved locator').not.toMatch(/Not saved|Storage conflict/);
}

export async function measureIncrementalAction(page: Page, name: string, action: () => Promise<void>) {
  const startTime = await page.evaluate(() => performance.now());
  await action();
  const end = await page.evaluate(() => new Promise<{ endTime: number; heapBytes?: number }>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({ endTime: performance.now(),
      ...((performance as any).memory ? { heapBytes: (performance as any).memory.usedJSHeapSize } : {}) })));
  }));
  return { name, startTime, endTime: end.endTime, actionThroughNextFrameMs: end.endTime - startTime, ...(end.heapBytes === undefined ? {} : { heapBytes: end.heapBytes }) };
}

export async function openIncrementalEditor(page: Page): Promise<void> {
  // Playwright's page fixture supplies a new, non-persistent context per test.
  if (page.context().pages().length !== 1 || page.url() !== 'about:blank') throw new Error('Use a fresh browser context');
  const webPort = process.env.E2E_WEB_PORT;
  if (!webPort || ['3000', '3001'].includes(webPort)) throw new Error('Isolated web port required');
  await page.context().route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/') || /analytics|telemetry|google-analytics/.test(url.hostname)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: url.pathname.includes('get-session') ? 'null' : '{}' });
    } else if (url.origin === `http://localhost:${webPort}` ||
      (route.request().method() === 'GET' && ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname))) {
      await route.continue();
    } else await route.abort();
  });
  await page.goto('/app');
  await expect(page.getByTestId('project-pane').first()).toBeVisible({ timeout: 120_000 });
}

export async function importIncrementalProject(page: Page, project: WorkspaceProject): Promise<void> {
  // The supported modal accepts AppState, not a WorkspaceProject wrapper.
  // Keep test metadata in Node; never introduce application-only import APIs.
  metadata.set(page, { id: project.id, name: project.name });
  await page.locator('[data-testid="project-pane"][data-active="true"]').getByRole('button', { name: 'JSON', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Project JSON Editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.locator('textarea').fill(JSON.stringify(project.initialState));
  await page.getByRole('button', { name: 'Apply Changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Project JSON Editor' })).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Saved locally' })
    .or(page.getByRole('alert').filter({ hasText: /Not saved|Storage conflict/ }))).toBeVisible({ timeout: 120_000 });
  await assertIncrementalSaveHealthy(page);
}

export async function readDownloadedProject(page: Page): Promise<WorkspaceProject> {
  const wrapper = metadata.get(page);
  if (!wrapper) throw new Error('No imported test metadata for this page');
  // Existing healthy-editor JSON download is exposed by Save JSON & Close.
  // Close only the disposable test project, after all interaction measurements.
  const downloadPromise = page.waitForEvent('download');
  if (await page.getByRole('button', { name: 'Download JSON', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  } else {
    await page.locator('[data-testid="project-tab"].text-blue-700').getByTitle('Close Project', { exact: true }).click();
    await page.getByRole('button', { name: 'Save JSON & Close', exact: true }).click();
  }
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error('JSON download has no readable stream');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const initialState = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(initialState).toHaveProperty('nodes');
  expect(initialState).toHaveProperty('variants');
  return { ...wrapper, initialState };
}
