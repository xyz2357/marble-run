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
      pick: (i: number | null) => void;
      select: (id: string | null) => void;
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

/** scrollWidth > clientWidth means content is hidden off to the side. */
async function expectNoSidewaysScroll(page: Page, selector: string) {
  const over = await page.locator(selector).evaluate((e) => e.scrollWidth - e.clientWidth);
  expect(over, `${selector} needs no sideways scrolling`).toBeLessThanOrEqual(1);
}

test('the controls you build with are all on screen without scrolling', async ({ page }) => {
  const errors = await boot(page);
  // Before this layout the toolbar was 1136px wide starting at x = -362 on a 412px screen; then
  // it scrolled sideways, which was no better - three screens of it, with the level buttons
  // (needed on almost every piece) off in the second one.
  await expectOnScreen(page, '#toolbar');
  await expectOnScreen(page, '#palette');
  await expectOnScreen(page, '#hud');
  await expectNoSidewaysScroll(page, '#toolbar');
  for (const action of ['mode-edit', 'mode-play', 'undo', 'level-down', 'level-up', 'frame', 'more']) {
    await expect(page.locator(`#toolbar [data-action="${action}"]`), `${action} is in the first row`).toBeVisible();
  }
  // The rest is one tap away, not three screens of scrolling.
  await expect(page.locator('#toolbar [data-action="view-top"]')).toBeHidden();
  await page.locator('#toolbar [data-action="more"]').tap();
  for (const action of ['tool-chain', 'view-top', 'clear', 'download', 'help']) {
    await expect(page.locator(`#toolbar [data-action="${action}"]`), `${action} is under "..."`).toBeVisible();
  }
  await expectOnScreen(page, '#toolbar');
  // The HUD follows the toolbar down instead of disappearing under it.
  const tb = (await page.locator('#toolbar').boundingBox())!;
  const hud = (await page.locator('#hud').boundingBox())!;
  expect(hud.y, 'HUD clears the expanded toolbar').toBeGreaterThanOrEqual(tb.y + tb.height);
  await page.locator('#toolbar [data-action="more"]').tap();
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
  await page.locator('#palette-toggle').tap();

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

test('the palette is a grid you can see, and opens and closes', async ({ page }) => {
  const errors = await boot(page);
  const palette = page.locator('#palette');
  // A single scrolling row meant 4.3 screens of sideways scrolling to reach the 23rd piece,
  // five visible at a time. Wrapped into a grid it scrolls the way a phone list should.
  await expectNoSidewaysScroll(page, '#palette');
  const collapsed = (await palette.boundingBox())!;
  expect(collapsed.height, 'one row until you ask for more').toBeLessThan(110);

  await page.locator('#palette-toggle').tap();
  const open = (await palette.boundingBox())!;
  expect(open.height, 'opens into a grid').toBeGreaterThan(250);
  await expectOnScreen(page, '#palette');
  await expectNoSidewaysScroll(page, '#palette');
  const visible = await palette.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return [...el.querySelectorAll('.piece')].filter((p) => {
      const b = p.getBoundingClientRect();
      return b.top >= box.top - 1 && b.bottom <= box.bottom + 1;
    }).length;
  });
  expect(visible, 'a useful number of pieces at once').toBeGreaterThanOrEqual(10);
  // Every piece is reachable by scrolling down, not sideways.
  await palette.locator('.piece').last().scrollIntoViewIfNeeded();
  await expect(palette.locator('.piece').last()).toBeVisible();

  await page.locator('#palette-toggle').tap();
  expect((await palette.boundingBox())!.height, 'closes again').toBeLessThan(110);
  expect(errors).toEqual([]);
});

test('the panels that follow a piece stay on screen', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__TEST__.loadDemo(1));
  // The selected-piece panel is centred on the piece; near an edge it used to be cut in half.
  for (const i of [0, 3, 7]) {
    await page.evaluate((n) => window.__TEST__.pick(n), i);
    await expectOnScreen(page, '#picked-panel');
  }
  await page.evaluate(() => window.__TEST__.pick(null));
  // The variant bar: the lift has eight of them, which used to wrap into a 142px block.
  await page.evaluate(() => {
    window.__TEST__.setToolMode('free');
    window.__TEST__.select('lift4');
  });
  await expectOnScreen(page, '#variants');
  const v = (await page.locator('#variants').boundingBox())!;
  expect(v.height, 'one row, not a block').toBeLessThan(60);
  const pal = (await page.locator('#palette').boundingBox())!;
  expect(v.y + v.height, 'clear of the palette').toBeLessThanOrEqual(pal.y);
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
