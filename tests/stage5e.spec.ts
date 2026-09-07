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

test('the wood grain follows the track and the demos still build', async ({ page }) => {
  // The grain needs UVs, which `sweep` did not use to write. Physics reads position and index
  // only, so the whole suite is the real regression check; this one just looks at the result.
  const errors = await boot(page);
  await page.evaluate(() => window.__TEST__.loadDemo(1));
  await page.evaluate(() => window.__TEST__.frameTrack());
  await page.screenshot({ path: 'test-results/stage5e-wood.png' });
  expect(errors).toEqual([]);
});
