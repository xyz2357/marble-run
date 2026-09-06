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
  clearMarbles: () => void;
  importJSON: (t: string) => void;
  setMode: (m: 'edit' | 'play') => void;
  loadDemo: (which: 1 | 2) => void;
  openPortsScreen: () => unknown[];
  audioStats: () => { notes: number };
  lookAt: (x: number, y: number, z: number, dist: number) => void;
  frameTrack: () => void;
};
declare global {
  interface Window {
    __TEST__: Seam;
  }
}

async function loadTrack(page: Page, pieces: Placed[]) {
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  await page.evaluate((json) => window.__TEST__.importJSON(json), JSON.stringify({ version: 1, pieces }));
  expect(await page.evaluate(() => window.__TEST__.openPortsScreen()), 'all ports connected').toHaveLength(0);
  await page.evaluate(() => {
    window.__TEST__.setMode('play');
    window.__TEST__.pause();
  });
}

async function runSeconds(page: Page, seconds: number, onSecond?: (s: number) => Promise<boolean | void>) {
  for (let s = 1; s <= seconds; s++) {
    await page.evaluate(() => window.__TEST__.stepN(120));
    if (onSecond && (await onSecond(s)) === true) return true;
  }
  return false;
}

test('lift carries the marble up six levels to the exit', async ({ page }) => {
  await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 1, rot: 0 },
    { def: 'slope_steep', cell: { x: 1, z: 0 }, level: 0, rot: 0 },
    { def: 'lift6', cell: { x: 2, z: 0 }, level: 0, rot: 0 },
    { def: 'end', cell: { x: 4, z: 0 }, level: 6, rot: 0 },
  ]);
  let maxY = -Infinity;
  const trail: string[] = [];
  const done = await runSeconds(page, 30, async (s) => {
    const m = (await page.evaluate(() => window.__TEST__.marbles()))[0];
    if (m) {
      maxY = Math.max(maxY, m.y);
      trail.push(`${s}s (${m.x.toFixed(2)}, ${m.y.toFixed(2)}, ${m.z.toFixed(2)}) v=${Math.hypot(m.vx, m.vy, m.vz).toFixed(2)}`);
    }
    if (s === 6) {
      await page.evaluate(() => window.__TEST__.lookAt(2.5, 1.5, 0, 6));
      await page.screenshot({ path: 'test-results/stage4b-lift.png' });
    }
    return (await page.evaluate(() => window.__TEST__.results().length)) >= 1;
  });
  console.log(trail.join('\n'));
  expect(done).toBe(true);
  expect(maxY).toBeGreaterThan(3.0);
});

test('gate holds a queue of marbles and releases them together', async ({ page }) => {
  await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 2, rot: 0 },
    { def: 'gate', cell: { x: 1, z: 0 }, level: 1, rot: 0 },
    { def: 'end', cell: { x: 2, z: 0 }, level: 1, rot: 0 },
  ]);
  await page.evaluate(() => {
    window.__TEST__.clearMarbles();
    window.__TEST__.spawnBurst(3, 0.25);
  });
  // The gate is closed for the first 2.3 s of each 3 s period: nothing gets through early.
  await runSeconds(page, 2);
  expect(await page.evaluate(() => window.__TEST__.results().length)).toBe(0);
  await page.evaluate(() => window.__TEST__.lookAt(1, 0.8, 0, 3.5));
  await page.screenshot({ path: 'test-results/stage4b-gate.png' });
  const trail: string[] = [];
  const done = await runSeconds(page, 8, async (s) => {
    const ms = await page.evaluate(() => window.__TEST__.marbles());
    trail.push(`${s + 2}s ` + ms.map((m) => `(${m.x.toFixed(2)},${m.y.toFixed(2)},${m.z.toFixed(2)})v=${Math.hypot(m.vx, m.vy, m.vz).toFixed(2)}`).join(' '));
    return (await page.evaluate(() => window.__TEST__.results().length)) >= 3;
  });
  console.log(trail.join('\n'));
  expect(done).toBe(true);
});

test('xylophone plays notes as the marble rolls over the bars', async ({ page }) => {
  await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 3, rot: 0 },
    { def: 'xylophone', cell: { x: 1, z: 0 }, level: 2, rot: 0 },
    { def: 'end', cell: { x: 3, z: 0 }, level: 2, rot: 0 },
  ]);
  const done = await runSeconds(page, 10, async () => (await page.evaluate(() => window.__TEST__.results().length)) >= 1);
  expect(done).toBe(true);
  expect((await page.evaluate(() => window.__TEST__.audioStats())).notes).toBeGreaterThanOrEqual(5);
  await page.evaluate(() => window.__TEST__.lookAt(1.5, 1.2, 0, 3.5));
  await page.screenshot({ path: 'test-results/stage4b-xylophone.png' });
});

test('mechanism demo track is closed and delivers marbles', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__.loadDemo(2));
  expect(await page.evaluate(() => window.__TEST__.openPortsScreen())).toHaveLength(0);
  await page.evaluate(() => {
    window.__TEST__.setMode('play');
    window.__TEST__.pause();
    window.__TEST__.spawnBurst(2, 1.5);
  });
  const trail: string[] = [];
  const done = await runSeconds(page, 80, async (s) => {
    const ms = await page.evaluate(() => window.__TEST__.marbles());
    if (s % 5 === 0) trail.push(`${s}s ` + ms.map((m) => `(${m.x.toFixed(1)},${m.y.toFixed(1)},${m.z.toFixed(1)})`).join(' '));
    return (await page.evaluate(() => window.__TEST__.results().length)) >= 2;
  });
  console.log(trail.join('\n'));
  await page.evaluate(() => window.__TEST__.frameTrack());
  await page.screenshot({ path: 'test-results/stage4b-demo2.png' });
  expect(done).toBe(true);
});
