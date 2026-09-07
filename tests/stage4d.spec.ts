import { test, expect, type Page } from '@playwright/test';

type M = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };
type Placed = { def: string; cell: { x: number; z: number }; level: number; rot: number };
type Seam = {
  ready: boolean;
  pause: () => void;
  stepN: (n: number) => void;
  marbles: () => M[];
  results: () => { id: number; color: number; time: number }[];
  spawnBurst: (n: number, interval?: number) => void;
  spawnAtStart: () => number[];
  clearMarbles: () => void;
  importJSON: (t: string) => void;
  setMode: (m: 'edit' | 'play') => void;
  pieces: () => Placed[];
  openPortsScreen: () => unknown[];
  lookAt: (x: number, y: number, z: number, dist: number) => void;
  frameTrack: () => void;
  loadDemo: (which: 1 | 2 | 3) => void;
  select: (id: string | null) => void;
  place: () => number | null;
  pick: (i: number | null) => void;
  picked: () => Placed | null;
  variants: () => string[];
  setVariant: (id: string) => boolean;
  cycleVariant: (dir?: number) => boolean;
  paletteIds: () => string[];
  editorState: () => { selected: string | null };
  clearTrack: () => void;
  setToolMode: (m: 'chain' | 'free') => void;
  setLevel: (n: number) => void;
};
declare global {
  interface Window {
    __TEST__: Seam;
  }
}

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  return errors;
}

async function loadTrack(page: Page, pieces: Placed[]) {
  const errors = await boot(page);
  await page.evaluate((json) => window.__TEST__.importJSON(json), JSON.stringify({ version: 1, pieces }));
  expect(await page.evaluate(() => window.__TEST__.openPortsScreen()), 'all ports connected').toHaveLength(0);
  await page.evaluate(() => {
    window.__TEST__.setMode('play');
    window.__TEST__.pause();
  });
  return errors;
}

/** Step in 0.1 s slices for up to `seconds`, collecting marble states; stops when `count` marbles finished. */
async function run(page: Page, seconds: number, count: number) {
  const samples: M[][] = [];
  for (let i = 0; i < seconds * 10; i++) {
    await page.evaluate(() => window.__TEST__.stepN(12));
    samples.push(await page.evaluate(() => window.__TEST__.marbles()));
    if ((await page.evaluate(() => window.__TEST__.results().length)) >= count) return { samples, done: true };
  }
  return { samples, done: false };
}

test('spring jump pad launches the marble in an arc into the catch tray and on to the end', async ({ page }) => {
  const errors = await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 3, rot: 0 },
    { def: 'jump', cell: { x: 1, z: 0 }, level: 2, rot: 0 },
    { def: 'end', cell: { x: 5, z: 0 }, level: 2, rot: 0 },
  ]);
  const { samples, done } = await run(page, 15, 1);
  const m = samples.map((s) => s[0]).filter(Boolean);
  const launch = m.find((s) => s.vy > 2.5);
  const peak = Math.max(...m.map((s) => s.y));
  console.log(`jump: launch v=(${launch?.vx.toFixed(2)}, ${launch?.vy.toFixed(2)}) peak y=${peak.toFixed(2)} time=${(m.length / 10).toFixed(1)}s`);
  expect(done).toBe(true);
  // Launched upwards at more than 2.5 m/s and flew clearly above the entry deck (y = 1.5 + 0.15).
  expect(launch).toBeTruthy();
  expect(peak).toBeGreaterThan(1.9);
  await page.evaluate(() => window.__TEST__.lookAt(2.5, 1.5, 0, 5));
  await page.screenshot({ path: 'test-results/stage4d-jump.png' });
  expect(errors).toEqual([]);
});

test('water wheel carries the marble down four levels inside its casing', async ({ page }) => {
  const errors = await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 6, rot: 0 },
    { def: 'wheel', cell: { x: 1, z: 0 }, level: 2, rot: 0 },
    { def: 'end', cell: { x: 3, z: 0 }, level: 2, rot: 0 },
  ]);
  const { samples, done } = await run(page, 20, 1);
  const m = samples.map((s) => s[0]).filter(Boolean);
  // Time spent inside the wheel (within its radius of the axle at world (1, 1.85)).
  const inside = m.filter((s) => Math.hypot(s.x - 1, s.y - 1.85) < 0.7).length / 10;
  const results = await page.evaluate(() => window.__TEST__.results());
  console.log(`wheel: inside ${inside.toFixed(1)}s, total ${results[0]?.time.toFixed(1)}s`);
  expect(done).toBe(true);
  expect(inside).toBeGreaterThan(0.8);
  await page.evaluate(() => window.__TEST__.lookAt(1, 2, 0, 4));
  await page.screenshot({ path: 'test-results/stage4d-wheel.png' });
  expect(errors).toEqual([]);
});

test('random splitter sends marbles to both sides', async ({ page }) => {
  await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 6, rot: 0 },
    { def: 'slope', cell: { x: 1, z: 0 }, level: 5, rot: 0 },
    { def: 'splitter_rnd', cell: { x: 3, z: 0 }, level: 4, rot: 0 },
    { def: 'end', cell: { x: 6, z: 1 }, level: 4, rot: 0 },
    { def: 'end', cell: { x: 6, z: -1 }, level: 4, rot: 0 },
  ]);
  await page.evaluate(() => {
    window.__TEST__.clearMarbles();
    window.__TEST__.spawnBurst(10, 1.2);
  });
  const { done } = await run(page, 40, 10);
  expect(done).toBe(true);
  const sides = (await page.evaluate(() => window.__TEST__.marbles())).map((m) => Math.sign(m.z));
  console.log('random splitter sides', JSON.stringify(sides));
  expect(sides.filter((s) => s > 0).length).toBeGreaterThan(0);
  expect(sides.filter((s) => s < 0).length).toBeGreaterThan(0);
});

test('piece families: one palette entry per family, V switches the placed piece in place', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__TEST__.clearTrack());
  const palette = await page.evaluate(() => window.__TEST__.paletteIds());
  // Family members are folded into one palette entry each.
  expect(palette).toContain('helix');
  expect(palette).not.toContain('helix2');
  expect(palette).not.toContain('lift10');
  expect(palette).not.toContain('splitter_rnd');
  expect(palette.length).toBe(24);
  // Only one palette button per family, and the variant bar lists the family.
  expect(await page.locator('#palette .piece').count()).toBe(24);
  await page.evaluate(() => {
    window.__TEST__.setToolMode('free');
    window.__TEST__.setLevel(6);
    window.__TEST__.select('helix');
  });
  expect(await page.evaluate(() => window.__TEST__.variants())).toEqual(['helix', 'helix2', 'helix3']);
  await expect(page.locator('#variants')).toBeVisible();
  await page.locator('#variants button[data-variant="helix3"]').click();
  expect((await page.evaluate(() => window.__TEST__.editorState())).selected).toBe('helix3');
  // The palette keeps the family's entry highlighted while a member is selected.
  await expect(page.locator('#palette .piece[data-id="helix"]')).toHaveClass(/active/);

  // Place it, pick it, then cycle variants: the piece is swapped in place.
  await page.mouse.move(640, 400);
  const id = await page.evaluate(() => window.__TEST__.place());
  expect(id).not.toBeNull();
  await page.evaluate(() => window.__TEST__.pick(0));
  expect((await page.evaluate(() => window.__TEST__.picked()))?.def).toBe('helix3');
  await page.keyboard.press('v');
  const after = await page.evaluate(() => window.__TEST__.pieces());
  expect(after).toHaveLength(1);
  expect(after[0].def).toBe('helix');
  expect(await page.evaluate(() => window.__TEST__.setVariant('helix2'))).toBe(true);
  expect((await page.evaluate(() => window.__TEST__.pieces()))[0].def).toBe('helix2');
  await page.screenshot({ path: 'test-results/stage4d-variants.png' });
});

test('family variants are real pieces: a 4-level lift and a fast gate deliver the marble', async ({ page }) => {
  await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 0, rot: 0 },
    { def: 'straight', cell: { x: 1, z: 0 }, level: 0, rot: 0 },
    { def: 'lift4', cell: { x: 2, z: 0 }, level: 0, rot: 0 },
    { def: 'gate_fast', cell: { x: 4, z: 0 }, level: 3, rot: 0 },
    { def: 'end', cell: { x: 5, z: 0 }, level: 3, rot: 0 },
  ]);
  const { done } = await run(page, 30, 1);
  const results = await page.evaluate(() => window.__TEST__.results());
  console.log(`lift4 + gate_fast: ${results[0]?.time.toFixed(1)}s`);
  expect(done).toBe(true);
});

test('demo 3 (helix, jump, wheel, random splitter) is closed and delivers marbles', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__TEST__.loadDemo(3));
  expect(await page.evaluate(() => window.__TEST__.openPortsScreen())).toHaveLength(0);
  await page.evaluate(() => {
    window.__TEST__.setMode('play');
    window.__TEST__.pause();
    window.__TEST__.spawnBurst(3, 1.5);
  });
  const { samples, done } = await run(page, 90, 3);
  const trail = samples.filter((_, i) => i % 50 === 0).map((s, i) => `${i * 5}s ` + s.map((m) => `(${m.x.toFixed(1)},${m.y.toFixed(1)},${m.z.toFixed(1)})`).join(' '));
  console.log(trail.join('\n'));
  await page.evaluate(() => window.__TEST__.frameTrack());
  await page.screenshot({ path: 'test-results/stage4d-demo3.png' });
  expect(done).toBe(true);
});
