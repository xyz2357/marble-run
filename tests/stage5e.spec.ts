import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __TEST__: { ready: boolean; loadDemo: (n?: number) => void; frameTrack: () => void; setMode: (m: 'edit' | 'play') => void };
  }
}

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  return errors;
}

test('the help panel opens from the toolbar, from ? and H, and closes with Esc', async ({ page }) => {
  const errors = await boot(page);
  const help = page.locator('#help');
  await expect(help).toBeHidden();

  await page.click('#toolbar [data-action="help"]');
  await expect(help).toBeVisible();
  // It covers what the HUD hint cannot: the two build modes, V for variants, and the play keys.
  await expect(help).toContainText('接龙');
  await expect(help).toContainText('换规格');
  await expect(help).toContainText('慢动作');
  await page.screenshot({ path: 'test-results/stage5e-help.png' });

  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await page.keyboard.press('?');
  await expect(help).toBeVisible();
  await page.keyboard.press('h');
  await expect(help).toBeHidden();
  await page.keyboard.press('h');
  await expect(help).toBeVisible();
  await page.click('#help h3 button');
  await expect(help).toBeHidden();
  expect(errors).toEqual([]);
});

test('the loading splash shows before the engine arrives and is gone after', async ({ page }) => {
  // Hold the entry module back so the static splash is on screen on its own.
  await page.route('**/src/main.ts', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  // 'commit' returns as soon as the HTML starts arriving, before the held-back module runs.
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#boot')).toBeVisible();
  await expect(page.locator('#boot')).toContainText('加载中');
  await page.screenshot({ path: 'test-results/stage5e-boot.png' });
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  await expect(page.locator('#boot')).toHaveCount(0);
});

test('the wood grain follows the track and the demos still build', async ({ page }) => {
  // The grain needs UVs, which `sweep` did not use to write. Physics reads position and index
  // only, so the whole suite is the real regression check; this one just looks at the result.
  const errors = await boot(page);
  await page.evaluate(() => window.__TEST__.loadDemo(1));
  await page.evaluate(() => window.__TEST__.frameTrack());
  await page.screenshot({ path: 'test-results/stage5e-wood.png' });
  expect(errors).toEqual([]);
});
