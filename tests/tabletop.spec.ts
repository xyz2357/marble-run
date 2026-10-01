import { test, expect, type Page } from '@playwright/test';

type Look = { tabletop: boolean; speed: number; marbleType: string; fov: number };
type Seam = {
  ready: boolean;
  pause: () => void;
  setMode: (m: 'edit' | 'play') => void;
  setShape: (id: string) => void;
  setTabletop: (on: boolean) => void;
  look: () => Look;
  loadDemo: (which?: number) => void;
  demos: () => string[];
};
declare global {
  interface Window {
    __TEST__: Seam;
  }
}

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  return errors;
}

const look = (page: Page) => page.evaluate(() => window.__TEST__.look());

test('the tabletop look brings steel balls, a long lens and 2x playback, and gives them back', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const t = window.__TEST__;
    t.loadDemo(t.demos().length);
    t.setMode('play');
    t.setShape('glass');
  });
  expect(await look(page)).toEqual({ tabletop: false, speed: 1, marbleType: 'glass', fov: 50 });

  await page.locator('#playbar [data-play="tabletop"]').click();
  expect(await look(page)).toEqual({ tabletop: true, speed: 2, marbleType: 'steel', fov: 30 });
  await expect(page.locator('#playbar [data-play="tabletop"]')).toHaveClass(/active/);
  await expect(page.locator('#playbar [data-play="speed"]')).toContainText('×2');
  await page.waitForTimeout(200); // a few frames through the depth-of-field composer
  await page.screenshot({ path: 'test-results/tabletop-tower.png' });

  await page.locator('#playbar [data-play="tabletop"]').click();
  expect(await look(page)).toEqual({ tabletop: false, speed: 1, marbleType: 'glass', fov: 50 });
  expect(errors).toEqual([]);
});

test('the speed button cycles 1x to 4x and back, and the label follows', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__TEST__.setMode('play'));
  const btn = page.locator('#playbar [data-play="speed"]');
  for (const n of [2, 3, 4, 1]) {
    await btn.click();
    expect((await look(page)).speed).toBe(n);
    await expect(btn).toContainText(`×${n}`);
  }
  await page.keyboard.press('x');
  expect((await look(page)).speed).toBe(2);
});

for (const vp of [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
]) {
  test(`the wider play bar keeps clear of the HUD on a ${vp.width}px desktop`, async ({ page }) => {
    await page.setViewportSize(vp);
    await boot(page);
    await page.evaluate(() => window.__TEST__.setMode('play'));
    await page.locator('#playbar [data-play="speed"]').click(); // longest HUD line: 快放×2
    await page.waitForTimeout(100); // ResizeObserver publishes --playbar-h
    const bar = (await page.locator('#playbar').boundingBox())!;
    const hud = (await page.locator('#hud').boundingBox())!;
    const overlapX = Math.min(bar.x + bar.width, hud.x + hud.width) - Math.max(bar.x, hud.x);
    const overlapY = Math.min(bar.y + bar.height, hud.y + hud.height) - Math.max(bar.y, hud.y);
    expect(overlapX <= 0 || overlapY <= 0, `play bar ${JSON.stringify(bar)} vs HUD ${JSON.stringify(hud)}`).toBe(true);
    expect(bar.x).toBeGreaterThanOrEqual(0);
    expect(bar.x + bar.width).toBeLessThanOrEqual(vp.width);
  });
}

test('the tabletop look survives a reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__TEST__.setTabletop(true));
  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  expect((await look(page)).tabletop).toBe(true);
  await page.evaluate(() => window.__TEST__.setTabletop(false));
  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  expect((await look(page)).tabletop).toBe(false);
});
