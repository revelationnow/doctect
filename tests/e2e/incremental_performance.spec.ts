import { test, expect } from '@playwright/test';
import { cpus, totalmem, platform, release } from 'node:os';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import type { WorkspaceProject } from '../../services/localWorkspace/contracts';
import { assertIncrementalLabelRestored, assertIncrementalElementRestored } from '../helpers/incrementalAssertions';
import { openIncrementalEditor, importIncrementalProject, readDownloadedProject, observeIncrementalPerformance, readIncrementalObservations, measureIncrementalAction, assertIncrementalSaveHealthy } from './incrementalBrowserHarness';

const phase = process.env.INCREMENTAL_PERFORMANCE_PHASE;
for (const scenario of ['small-control', 'sticker-press', 'three-large-projects'] as const) {
  test(`incremental baseline scenarios: ${scenario}`, async ({ page, browser }, testInfo) => {
    // Baseline has multi-second full-document stalls, especially with three
    // projects. The 1800-second three-project limit permits slow-baseline
    // collection through drain/export; it is not a latency success criterion.
    test.setTimeout(scenario === 'three-large-projects' ? 1_800_000 : 600_000);
    page.setDefaultTimeout(scenario === 'three-large-projects' ? 120_000 : 30_000);
    expect(['baseline', 'final']).toContain(phase);
    expect(process.env.E2E_BUILT_BUNDLE).toBe('1');
    const project: WorkspaceProject = JSON.parse(readFileSync(`${process.env.INCREMENTAL_OUTPUT_DIR}/${scenario === 'small-control' ? 'small-control' : 'sticker-press'}.json`, 'utf8'));
    const count = scenario === 'three-large-projects' ? 3 : 1;
    await observeIncrementalPerformance(page);
    await openIncrementalEditor(page);
    const actions = [];
    for (let index = 0; index < count; index++) {
      if (index) {
        await page.getByTitle('New Project', { exact: true }).click();
        await page.getByRole('button', { name: /Blank Project/ }).click();
        // Creation commits asynchronously. Resolving data-active immediately
        // can retain the old pane's button while the new pane covers it.
        await expect(page.getByTestId('project-pane')).toHaveCount(index + 1, { timeout: 60_000 });
        await expect(page.getByTestId('project-pane').nth(index)).toHaveAttribute('data-active', 'true');
      }
      actions.push(await measureIncrementalAction(page, 'bulk-import', () => importIncrementalProject(page, project)));
    }
    const pane = page.locator('[data-testid="project-pane"][data-active="true"]');
    const templates = project.initialState.variants[project.initialState.activeVariantId].templates;
    const rootTemplate = templates[project.initialState.nodes[project.initialState.rootId].type];
    const label = rootTemplate.elements.find(element => element.type === 'text' && element.text)!;
    const target = pane.locator(`[data-element-id="${label.id}"]`);
    // Warmup plus five repeats; never choose only the fastest run.
    for (let sample = 0; sample < 6; sample++) {
      const measure = async (name: string, operation: () => Promise<void>) => {
        await assertIncrementalSaveHealthy(page);
        const action = { sample, warmup: sample === 0, ...await measureIncrementalAction(page, name, operation) };
        actions.push(action);
        // Node-side progress survives interrupted runs; never serialize the
        // document in the browser merely to collect benchmark diagnostics.
        appendFileSync(`${process.env.INCREMENTAL_OUTPUT_DIR}/${scenario}-actions.jsonl`, `${JSON.stringify(action)}\n`, { mode: 0o600 });
        console.info(`[incremental] ${scenario} sample=${sample} ${name}: ${action.actionThroughNextFrameMs.toFixed(1)} ms`);
        await assertIncrementalSaveHealthy(page);
      };
      await measure('navigation', async () => {
        await pane.getByRole('button', { name: 'Templates', exact: true }).click();
        await pane.getByRole('button', { name: 'Hierarchy', exact: true }).click();
      });
      await target.click({ position: { x: 12, y: 8 } });
      const editor = pane.getByPlaceholder('Text content or {{field}}');
      await measure('single-label-edit', async () => {
        await editor.fill(`${label.text} ${sample}`);
        await editor.press('Tab');
      });
      await expect(target).toContainText(`${label.text} ${sample}`);
      await measure('undo-label', async () => {
        await pane.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
      });
      // The properties textarea exposes the source value, unlike canvas text
      // which may wrap, clip, or resolve bindings. Retained sample suffixes fail.
      await expect(editor).toHaveValue(label.text!);
      assertIncrementalLabelRestored(await editor.inputValue(), label.text!);
      await target.click({ position: { x: 12, y: 8 } });
      const before = await target.boundingBox();
      expect(before).not.toBeNull();
      await measure('continuous-drag', async () => {
        await page.mouse.move(before!.x + before!.width / 4, before!.y + before!.height / 2);
        await page.mouse.down();
        await page.mouse.move(before!.x + before!.width / 4 + 36, before!.y + before!.height / 2 + 24, { steps: 12 });
        await page.mouse.up();
      });
      expect((await target.boundingBox())!.x).toBeGreaterThan(before!.x + 5);
      await measure('undo-drag', async () => {
        await pane.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
      });
      expect((await target.boundingBox())!.x).toBeCloseTo(before!.x, 0);
      // Include pending baseline autosave work; this is not a durability claim.
      await page.waitForTimeout(2500);
      await assertIncrementalSaveHealthy(page);
    }
    await expect(page.getByRole('status').filter({ hasText: 'Saving locally' })).toHaveCount(0, { timeout: 120_000 });
    const savedLocally = await page.getByRole('status').filter({ hasText: 'Saved locally' }).isVisible();
    const observations = readIncrementalObservations(page);
    const exported = await readDownloadedProject(page);
    if (!savedLocally) await testInfo.attach('unsaved-fixture-state.json', { body: JSON.stringify(exported.initialState), contentType: 'application/json' });
    expect(Object.keys(exported.initialState.nodes)).toHaveLength(Object.keys(project.initialState.nodes).length);
    expect(Object.keys(exported.initialState.variants)).toHaveLength(Object.keys(project.initialState.variants).length);
    const exportedTemplate = exported.initialState.variants[project.initialState.activeVariantId]
      ?.templates[project.initialState.nodes[project.initialState.rootId].type];
    assertIncrementalElementRestored(exportedTemplate?.elements.find(element => element.id === label.id), label);
    const report = {
      phase, scenario, projectCount: count, repetitions: 5, warmupRuns: 1,
      fixture: { stateBytes: Buffer.byteLength(JSON.stringify(project.initialState)), sha256: createHash('sha256').update(JSON.stringify(project.initialState)).digest('hex') },
      environment: { node: process.version, browser: browser.version(), platform: platform(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), viewport: page.viewportSize() },
      actions, observations, savedLocally,
      unavailable: ['documentWrites', 'unrelatedPayloadReads', 'unrelatedPayloadWrites', 'fullDocumentClones', 'admissionMs', 'validationMs', 'transferMs', 'transactionMs', 'readBackMs', 'publicationMs', 'persistenceAttributedLongTasks', 'latestRevisionDurabilityMs'],
      notes: ['Long tasks are whole-page observations, not attributed to persistence.', 'Action duration includes Playwright control overhead and two animation frames; Event Timing entries are reported separately.', 'Event Timing omits events below browser reporting threshold; no fabricated zero latency.', 'Task 1 is measurement-only in both phases; Task 15 must add final work/latency assertions.'],
    };
    await testInfo.attach('incremental-performance.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    writeFileSync(`${process.env.INCREMENTAL_OUTPUT_DIR}/${scenario}-report.json`, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    expect(savedLocally, 'Baseline save failure: see timing report and exported fixture diagnostic').toBe(true);
  });
}
