import { test, expect } from '@playwright/test';
import { seedNativeProject } from './localWorkspaceHelpers.js';
import { layoutFixture as fixture } from './fixtures/layoutFixture.js';

const activePane = page => page.locator('[data-testid="project-pane"][data-active="true"]');
const shot = { maxDiffPixelRatio: 0.01, animations: 'disabled' };

test.describe('desktop editor layout guard', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'baselines are recorded on Chromium');

    test.beforeEach(async ({ page }) => {
        await seedNativeProject(page, { id: 'layout-guard', name: 'Layout Guard', initialState: fixture });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/app');
        await expect(activePane(page).getByTestId('editor-canvas')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
    });

    test('idle editor', async ({ page }) => {
        await expect(page).toHaveScreenshot('idle.png', { ...shot, mask: [page.getByRole('status')] });
    });

    test('element selected', async ({ page }) => {
        await activePane(page).locator('[data-element-id="box"]').click();
        await expect(page).toHaveScreenshot('selected.png', { ...shot, mask: [page.getByRole('status')] });
    });

    test('generator open', async ({ page }) => {
        await activePane(page).getByTitle('Generate Hierarchy via Script').click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page).toHaveScreenshot('generator.png', { ...shot, mask: [page.getByRole('status')] });
    });
});
