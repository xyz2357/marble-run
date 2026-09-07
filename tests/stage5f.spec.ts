import { test, expect, devices, type Page } from '@playwright/test';

// Everything in this file runs as a phone: 412x839, touch, no hover, no keyboard.
test.use({ ...devices['Pixel 7'] });

declare global {
  interface Window {
    __TEST__: {
      ready: boolean;
      clearTrack: () => void;
      setToolMode: (m: 'chain' | 'free') => void;
      setMode: (m: 'edit' | 'play') => void;
      mode: () => string;
      pieces: () => unknown[];
      marbles: () => unknown[];
      editorState: () => { selected: string | null };
      loadDemo: (n?: number) => void;
    };
  }
}

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  return errors;
}

/** Nothing may hang off the side of the screen: that is where the controls used to be. */
async function expectOnScreen(page: Page, selector: string) {
  const vp = page.viewportSize()!;
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} is laid out`).toBeTruthy();
  expect(box!.x, `${selector} starts on screen`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${selector} ends on screen`).toBeLessThanOrEqual(vp.width);
  expect(box!.y, `${selector} starts below the top`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${selector} ends above the bottom`).toBeLessThanOrEqual(vp.height);
}

test('every bar fits the screen instead of hanging off both sides', async ({ page }) => {
  const errors = await boot(page);
  // Before this layout the toolbar was 1136px wide starting at x = -362 on a 412px screen, so
  // the edit/play switch and the import/export buttons were both unreachable.
  await expectOnScreen(page, '#toolbar');
  await expectOnScreen(page, '#palette');
  await expectOnScreen(page, '#hud');
  // The palette is a strip along the bottom now, not a column eating a third of the width.
  const pal = (await page.locator('#palette').boundingBox())!;
  expect(pal.height, 'palette is a strip, not a column').toBeLessThan(160);
  expect(pal.width, 'palette spans the screen').toBeGreaterThan(300);
  await page.screenshot({ path: 'test-results/stage5f-edit.png' });

  await page.evaluate(() => window.__TEST__.setMode('play'));
  await expectOnScreen(page, '#toolbar');
  await expectOnScreen(page, '#playbar');
  await expectOnScreen(page, '#race');
  // The race panel sits above the play bar rather than on top of it.
  const race = (await page.locator('#race').boundingBox())!;
  const bar = (await page.locator('#playbar').boundingBox())!;
  expect(race.y + race.height, 'race panel clears the play bar').toBeLessThanOrEqual(bar.y + 1);
  await page.screenshot({ path: 'test-results/stage5f-play.png' });
  expect(errors).toEqual([]);
});

test('a track can be built and run with taps alone', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    window.__TEST__.clearTrack();
    window.__TEST__.setToolMode('chain');
  });
  const vp = page.viewportSize()!;

  await page.locator('#palette .piece[data-id="start"]').tap();
  expect((await page.evaluate(() => window.__TEST__.editorState())).selected).toBe('start');

  // Tapping the ground places it: there is no hover on a phone, so the candidate has to be
  // resolved from the tap itself.
  await page.touchscreen.tap(vp.width / 2, vp.height / 2);
  expect(await page.evaluate(() => window.__TEST__.pieces().length), 'first piece placed by tap').toBe(1);

  await page.locator('#palette .piece[data-id="slope"]').tap();
  await page.touchscreen.tap(vp.width / 2, vp.height / 2);
  expect(await page.evaluate(() => window.__TEST__.pieces().length), 'second piece chained on').toBe(2);

  await page.locator('#toolbar [data-action="mode-play"]').tap();
  expect(await page.evaluate(() => window.__TEST__.mode())).toBe('play');
  await page.locator('#playbar [data-play="one"]').tap();
  expect((await page.evaluate(() => window.__TEST__.marbles())).length, 'the play bar spawns').toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/stage5f-built.png' });
  expect(errors).toEqual([]);
});

test('keyboard hints are dropped where there is no keyboard', async ({ page }) => {
  await boot(page);
  const hud = page.locator('#hud');
  await expect(hud).toContainText('接龙模式');
  await expect(hud, 'no key list in the editor HUD').not.toContainText('[Backspace]');
  await page.evaluate(() => window.__TEST__.setMode('play'));
  await expect(hud).toContainText('试玩模式');
  await expect(hud, 'no Tab hint in the play HUD').not.toContainText('[Tab]');
  // The kbd chips on the buttons and the number badges on the palette go too.
  expect(await page.locator('#playbar kbd:visible').count()).toBe(0);
  await page.evaluate(() => window.__TEST__.setMode('edit'));
  expect(await page.locator('#palette kbd:visible').count()).toBe(0);
});
