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
      picked: () => { def: string; rot: number } | null;
      setVariant: (id: string) => void;
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

/**
 * Two boxes may not share pixels. Polled: the floating panels are placed from the render loop,
 * so a box can be one frame behind the HUD text that just changed under it.
 */
async function expectNoOverlap(page: Page, a: string, b: string) {
  const measure = ([sa, sb]: string[]) => {
    const ea = document.querySelector(sa);
    const eb = document.querySelector(sb);
    if (!ea || !eb) return null;
    const ra = ea.getBoundingClientRect();
    const rb = eb.getBoundingClientRect();
    const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    return { over: Math.round(Math.min(ix, iy)), a: [Math.round(ra.top), Math.round(ra.bottom)], b: [Math.round(rb.top), Math.round(rb.bottom)] };
  };
  let last: Awaited<ReturnType<typeof page.evaluate<ReturnType<typeof measure>, string[]>>> = null;
  await expect
    .poll(async () => {
      last = await page.evaluate(measure, [a, b]);
      return last ? last.over : 9999;
    }, { message: `${a} overlaps ${b}`, timeout: 5000 })
    .toBeLessThanOrEqual(1);
  expect(last, `${a} and ${b} are both laid out`).toBeTruthy();
}

/**
 * Every control inside `selector` is the thing the screen hands back at its own centre. An
 * on-screen bounding box is not enough: the HUD is pointer-events:none, so it painted over the
 * picked-piece panel while leaving the buttons underneath tappable - invisible but live.
 */
async function expectControlsHittable(page: Page, selector: string, children = 'button, select') {
  const bad = await page.evaluate(([sel, kids]) => {
    const host = document.querySelector(sel);
    if (!host) return ['missing: ' + sel];
    const out: string[] = [];
    for (const c of host.querySelectorAll(kids)) {
      const r = c.getBoundingClientRect();
      if (r.width === 0) continue;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!top || (top !== c && !c.contains(top) && !top.contains(c))) {
        out.push(`${c.textContent?.trim()} is covered by ${top ? (top.id || top.tagName) : 'nothing'}`);
      }
    }
    return out;
  }, [selector, children]);
  expect(bad, `${selector}: every control is the topmost thing at its own centre`).toEqual([]);
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

// ---------------------------------------------------------------------------------------------
// A playtest at 412x915 turned up five things you could see but not use. Each of these pins one.

test('the picked-piece panel is on top of the HUD, not painted over by it', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__TEST__.loadDemo(1));
  // #hud is a sibling of #ui and comes after it, so with no z-index it won the paint order:
  // the panel landed at y 131-176 inside a HUD occupying 114-185, and 旋转 / 规格 / 删除 were
  // invisible - yet still tappable, because the HUD is pointer-events:none.
  for (const i of [0, 1, 5]) {
    await page.evaluate((n) => window.__TEST__.pick(n), i);
    await expect(page.locator('#picked-panel')).toBeVisible();
    await expectOnScreen(page, '#picked-panel');
    await expectNoOverlap(page, '#picked-panel', '#hud');
    await expectNoOverlap(page, '#picked-panel', '#toolbar');
    await expectControlsHittable(page, '#picked-panel');
  }
  expect(errors).toEqual([]);
});

test('a tap on the picked-piece panel reaches the button you can see', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    window.__TEST__.loadDemo(1);
    window.__TEST__.setToolMode('free');
    window.__TEST__.pick(1);
  });
  const before = await page.evaluate(() => window.__TEST__.pieces().length);
  // 删除 is the button the HUD used to cover. A raw touchscreen tap at its centre, not a
  // synthesised click on the element: that is the whole point of the bug.
  const del = page.locator('#picked-panel [data-picked="delete"]');
  await expect(del).toBeVisible();
  const box = (await del.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(async () => page.evaluate(() => window.__TEST__.pieces().length), { message: 'tapping 删除 removed the piece' })
    .toBe(before - 1);
  await page.screenshot({ path: 'test-results/stage5f-picked-panel.png' });
  expect(errors).toEqual([]);
});

test('the help overlay fits inside the screen', async ({ page }) => {
  const errors = await boot(page);
  // width was content-box, so 20px of padding and a 1px border landed on top of
  // "calc(100vw - 32px)": 422px wide on a 412px screen, starting at x = -5.
  await page.locator('#toolbar [data-action="more"]').tap();
  await page.locator('#toolbar [data-action="help"]').tap();
  await expect(page.locator('#help')).toBeVisible();
  await expectOnScreen(page, '#help');
  await expectNoSidewaysScroll(page, '#help');
  const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(doc.sw, 'the page itself does not scroll sideways either').toBeLessThanOrEqual(doc.cw);
  await page.screenshot({ path: 'test-results/stage5f-help.png' });
  expect(errors).toEqual([]);
});

test('the help overlay still lists its shortcuts on a touch screen', async ({ page }) => {
  const errors = await boot(page);
  // "@media (pointer: coarse) { kbd { display: none } }" is meant to drop the key chips from
  // the buttons you tap. Applied to the help it emptied every <dt>, leaving the descriptions
  // with nothing beside them - "撤销 / 重做" preceded by a bare "+ /". A phone can have a
  // keyboard plugged into it, and the help is a reference, not a control: keep the keys.
  await page.locator('#toolbar [data-action="more"]').tap();
  await page.locator('#toolbar [data-action="help"]').tap();
  await expect(page.locator('#help')).toBeVisible();
  expect(await page.locator('#help kbd:visible').count(), 'the key chips are still drawn').toBeGreaterThan(10);
  const empty = await page.evaluate(() =>
    [...document.querySelectorAll('#help dt')].filter((d) => d.getBoundingClientRect().width < 4).map((d) => d.textContent ?? ''),
  );
  expect(empty, 'no description is left with a blank term beside it').toEqual([]);
  await expect(page.locator('#help dt', { hasText: 'Backspace' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the play bar fits, with every control on screen and reachable', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    window.__TEST__.loadDemo(1);
    window.__TEST__.setMode('play');
  });
  const bar = page.locator('#playbar');
  await expect(bar).toBeVisible();
  // One row came to 682px of content in a 398px box: 暂停 / 音效 / 弹珠 were off the right
  // (跟随 too at 360px). It scrolled, but with the scrollbar hidden nothing said so.
  await expectOnScreen(page, '#playbar');
  await expectNoSidewaysScroll(page, '#playbar');
  await expectControlsHittable(page, '#playbar');
  const vp = page.viewportSize()!;
  const offscreen = await bar.evaluate((el, w) =>
    [...el.querySelectorAll('button, select')]
      .filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left < 0 || r.right > w;
      })
      .map((c) => c.textContent?.trim() ?? ''), vp.width);
  expect(offscreen, 'nothing hangs off the right').toEqual([]);
  // Tapping the control that used to be off the edge still works, with no scrolling first.
  await page.locator('#playbar [data-play="pause"]').tap();
  await expect(page.locator('#playbar [data-play="pause"]')).toHaveClass(/active/);
  await expectNoOverlap(page, '#playbar', '#race');
  await expectNoOverlap(page, '#playbar', '#hud');
  await page.screenshot({ path: 'test-results/stage5f-playbar.png' });
  expect(errors).toEqual([]);
});

test('the HUD names no keys where there is no keyboard', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    window.__TEST__.loadDemo(1);
    window.__TEST__.setToolMode('free');
    window.__TEST__.pick(1);
  });
  const hud = page.locator('#hud');
  await expect(hud, 'it still says what is selected').toContainText('已选中');
  // "R 旋转  Delete 删除  Q/E 升降" told a phone about keys it does not have; the panel that
  // does the same job is right there on the piece.
  for (const key of ['R 旋转', 'Delete', 'Q/E', '方向键', 'V 换规格']) {
    await expect(hud, `no "${key}" in the HUD`).not.toContainText(key);
  }
  await page.evaluate(() => {
    window.__TEST__.pick(null);
    window.__TEST__.setToolMode('chain');
    window.__TEST__.clearTrack();
  });
  await expect(hud).not.toContainText('按数字键');
  await expect(hud).not.toContainText('Enter');
  expect(errors).toEqual([]);
});

test('the palette toggle sits clear of the palette, open or shut', async ({ page }) => {
  const errors = await boot(page);
  // max-height caps the CONTENT unless the box is border-box, so the collapsed bar measured
  // 98px against the 84px the toggle is positioned from and the button sat 8px inside it.
  await expectNoOverlap(page, '#palette', '#palette-toggle');
  await page.locator('#palette-toggle').tap();
  await expectNoOverlap(page, '#palette', '#palette-toggle');
  await expectOnScreen(page, '#palette-toggle');
  await page.locator('#palette-toggle').tap();
  await expectNoOverlap(page, '#palette', '#palette-toggle');
  expect(errors).toEqual([]);
});

test('a row that scrolls sideways says that it does', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    window.__TEST__.setToolMode('free');
    window.__TEST__.select('lift4');
  });
  const bar = page.locator('#variants');
  await expect(bar).toBeVisible();
  // The lift has eight variants: 321px of them sit off the right of a 412px screen, and the
  // scrollbar is hidden. The bar records which end still has content, so CSS can fade it.
  const over = await bar.evaluate((e) => e.scrollWidth - e.clientWidth);
  expect(over, 'this is the case worth warning about').toBeGreaterThan(20);
  await expect(bar).toHaveAttribute('data-scroll', 'start');
  await bar.evaluate((e) => e.scrollTo({ left: e.scrollWidth }));
  await expect(bar, 'and stops saying it once you get there').toHaveAttribute('data-scroll', 'end');
  await bar.evaluate((e) => e.scrollTo({ left: Math.round((e.scrollWidth - e.clientWidth) / 2) }));
  await expect(bar, 'both ends have more, in the middle').toHaveAttribute('data-scroll', 'mid');
  await bar.evaluate((e) => e.scrollTo({ left: 0 }));
  await expect(bar).toHaveAttribute('data-scroll', 'start');
  // The masks are what a person actually sees; the attribute is what drives them.
  const masked = await bar.evaluate((e) => getComputedStyle(e).maskImage);
  expect(masked, 'the far edge is faded out').toContain('gradient');
  expect(errors).toEqual([]);
});

test.describe('a smaller phone, 360x740', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('everything still fits', async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate(() => window.__TEST__.loadDemo(1));
    await expectOnScreen(page, '#toolbar');
    await expectOnScreen(page, '#hud');
    await expectOnScreen(page, '#palette');
    await expectNoOverlap(page, '#palette', '#palette-toggle');

    await page.locator('#toolbar [data-action="more"]').tap();
    await page.locator('#toolbar [data-action="help"]').tap();
    await expectOnScreen(page, '#help');
    await page.locator('#help [data-action="help-close"]').tap();

    await page.evaluate(() => window.__TEST__.pick(1));
    await expect(page.locator('#picked-panel')).toBeVisible();
    await expectOnScreen(page, '#picked-panel');
    await expectNoOverlap(page, '#picked-panel', '#hud');
    await expectNoOverlap(page, '#picked-panel', '#toolbar');
    await expectControlsHittable(page, '#picked-panel');

    await page.evaluate(() => window.__TEST__.setMode('play'));
    await expectOnScreen(page, '#playbar');
    await expectNoSidewaysScroll(page, '#playbar');
    await expectControlsHittable(page, '#playbar');
    await expectNoOverlap(page, '#playbar', '#race');
    await expectOnScreen(page, '#race');
    await page.screenshot({ path: 'test-results/stage5f-360-play.png' });
    expect(errors).toEqual([]);
  });
});

test.describe('the phone on its side, 740x360', () => {
  test.use({ viewport: { width: 740, height: 360 } });

  test('the short screen still has room for the controls', async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate(() => window.__TEST__.loadDemo(1));
    for (const sel of ['#toolbar', '#hud', '#palette', '#palette-toggle']) await expectOnScreen(page, sel);
    await expectNoOverlap(page, '#palette', '#palette-toggle');
    await expectNoOverlap(page, '#toolbar', '#hud');

    await page.evaluate(() => window.__TEST__.pick(1));
    await expect(page.locator('#picked-panel')).toBeVisible();
    await expectOnScreen(page, '#picked-panel');
    await expectNoOverlap(page, '#picked-panel', '#toolbar');
    await expectNoOverlap(page, '#picked-panel', '#hud');

    await page.locator('#toolbar [data-action="more"]').tap();
    await page.locator('#toolbar [data-action="help"]').tap();
    await expectOnScreen(page, '#help');
    await page.locator('#help [data-action="help-close"]').tap();

    await page.evaluate(() => window.__TEST__.setMode('play'));
    await expectOnScreen(page, '#playbar');
    await expectNoSidewaysScroll(page, '#playbar');
    await expectNoOverlap(page, '#playbar', '#race');
    expect(errors).toEqual([]);
  });
});

test.describe('a tablet, 820x1180 - touch, but wide enough for the desktop bars', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('the touch-sized bars keep clear of the corner panels', async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate(() => window.__TEST__.loadDemo(1));
    // Touch padding makes the desktop bars bigger without making the screen any wider: #race
    // and #palette were clipped 3px under the toolbar, and the 684px play bar ran 126px into
    // the bottom-left HUD.
    await expectNoOverlap(page, '#toolbar', '#palette');
    await page.evaluate(() => window.__TEST__.setMode('play'));
    await expectNoOverlap(page, '#toolbar', '#race');
    await expectNoOverlap(page, '#playbar', '#hud');
    await expectControlsHittable(page, '#playbar');
    await expectOnScreen(page, '#playbar');
    await expectOnScreen(page, '#race');
    await page.screenshot({ path: 'test-results/stage5f-tablet-play.png' });
    expect(errors).toEqual([]);
  });
});
