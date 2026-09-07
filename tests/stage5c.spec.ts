import { test, expect, type Page } from '@playwright/test';

type M = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };
type Placed = { def: string; cell: { x: number; z: number }; level: number; rot: number };
type Seam = {
  ready: boolean;
  pause: () => void;
  stepN: (n: number) => void;
  marbles: () => M[];
  results: () => { id: number }[];
  spawnBurst: (n: number, interval?: number) => void;
  clearMarbles: () => void;
  importJSON: (t: string) => void;
  setMode: (m: 'edit' | 'play') => void;
  openPortsScreen: () => unknown[];
  lookAt: (x: number, y: number, z: number, dist: number) => void;
};
declare global {
  interface Window {
    __TEST__: Seam;
  }
}

/** start -> slope -> splitter at (3,0,L4) -> one end per branch. The splitter spans x = 2.5 .. 5.5. */
const SPLIT_RIG: Placed[] = [
  { def: 'start', cell: { x: 0, z: 0 }, level: 6, rot: 0 },
  { def: 'slope', cell: { x: 1, z: 0 }, level: 5, rot: 0 },
  { def: 'splitter', cell: { x: 3, z: 0 }, level: 4, rot: 0 },
  { def: 'end', cell: { x: 6, z: 1 }, level: 4, rot: 0 },
  { def: 'end', cell: { x: 6, z: -1 }, level: 4, rot: 0 },
];

async function loadTrack(page: Page, pieces: Placed[]) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  await page.evaluate((json) => window.__TEST__.importJSON(json), JSON.stringify({ version: 1, pieces }));
  expect(await page.evaluate(() => window.__TEST__.openPortsScreen()), 'all ports connected').toHaveLength(0);
  await page.evaluate(() => {
    window.__TEST__.setMode('play');
    window.__TEST__.pause();
    window.__TEST__.clearMarbles();
  });
  return errors;
}

/** Which branch each marble took, in spawn order, once it is clear of the splitter. */
async function branches(page: Page, n: number, steps = 600) {
  const side = new Map<number, number>();
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => window.__TEST__.stepN(12));
    for (const m of await page.evaluate(() => window.__TEST__.marbles())) {
      if (m.x > 5.6 && !side.has(m.id)) side.set(m.id, Math.sign(m.z));
    }
    if (side.size >= n) break;
  }
  return [...side.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, s]) => (s > 0 ? 'R' : 'L'))
    .join('');
}

test('splitter alternates branch by branch', async ({ page }) => {
  const errors = await loadTrack(page, SPLIT_RIG);
  await page.evaluate(() => window.__TEST__.spawnBurst(6, 3));
  expect(await branches(page, 6)).toBe('RLRLRL');
  expect(errors).toEqual([]);
});

test('splitter still alternates after marbles are cleared while one is inside it', async ({ page }) => {
  const errors = await loadTrack(page, SPLIT_RIG);
  await page.evaluate(() => window.__TEST__.spawnBurst(1));
  // Step until the marble is over the flap, then reset - the case that used to wedge the flap
  // for good, because the destroyed marble's id stayed in the "still inside" set forever.
  let reached = false;
  for (let i = 0; i < 200 && !reached; i++) {
    await page.evaluate(() => window.__TEST__.stepN(6));
    reached = (await page.evaluate(() => window.__TEST__.marbles())).some((m) => m.x > 3.4 && m.x < 4.1);
  }
  expect(reached, 'marble reached the flap before the reset').toBe(true);
  await page.evaluate(() => window.__TEST__.clearMarbles());

  await page.evaluate(() => window.__TEST__.spawnBurst(6, 3));
  expect(await branches(page, 6), 'the flap is not stuck on one side').toBe('RLRLRL');
  expect(errors).toEqual([]);
});

test('a dense burst still crosses the splitter safely, even though it cannot alternate', async ({ page }) => {
  const errors = await loadTrack(page, SPLIT_RIG);
  await page.evaluate(() => window.__TEST__.spawnBurst(8, 0.35));
  let maxSpeed = 0;
  for (let i = 0; i < 500; i++) {
    await page.evaluate(() => window.__TEST__.stepN(12));
    for (const m of await page.evaluate(() => window.__TEST__.marbles())) {
      // Over the flap. A flip under a marble used to throw it out at up to 10 m/s.
      if (m.x > 2.4 && m.x < 4.5) maxSpeed = Math.max(maxSpeed, Math.hypot(m.vx, m.vy, m.vz));
    }
    if ((await page.evaluate(() => window.__TEST__.results().length)) >= 7) break;
  }
  console.log(`dense burst: max speed over the flap ${maxSpeed.toFixed(2)} m/s`);
  // Marbles arrive at about 2.9 m/s; anything much above that means the flap hit one.
  expect(maxSpeed).toBeLessThan(4);
  expect(errors).toEqual([]);
});

test('glass shafts keep their colliders: the lift still carries marbles up', async ({ page }) => {
  const errors = await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 2, rot: 0 },
    { def: 'slope_steep', cell: { x: 1, z: 0 }, level: 1, rot: 0 },
    { def: 'lift6', cell: { x: 2, z: 0 }, level: 1, rot: 0 },
    { def: 'slope', cell: { x: 4, z: 0 }, level: 6, rot: 0 },
    { def: 'end', cell: { x: 6, z: 0 }, level: 6, rot: 0 },
  ]);
  await page.evaluate(() => window.__TEST__.spawnBurst(2, 2));
  let done = false;
  const peak: number[] = [];
  for (let i = 0; i < 900 && !done; i++) {
    await page.evaluate(() => window.__TEST__.stepN(12));
    for (const m of await page.evaluate(() => window.__TEST__.marbles())) peak.push(m.y);
    done = (await page.evaluate(() => window.__TEST__.results().length)) >= 2;
  }
  // Marbles were lifted well above the entry (y = 0.5) - the shaft walls still hold them in.
  expect(Math.max(...peak)).toBeGreaterThan(3);
  expect(done, 'the lift delivered two marbles').toBe(true);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.__TEST__.lookAt(2.5, 2, 0, 6));
  await page.screenshot({ path: 'test-results/stage5c-lift-glass.png' });
});
