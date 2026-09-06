import { test, expect, type Page } from '@playwright/test';

type M = { id: number; shape: string; x: number; y: number; z: number; vx: number; vy: number; vz: number };
type Placed = { def: string; cell: { x: number; z: number }; level: number; rot: number };
type Seam = {
  ready: boolean;
  pause: () => void;
  stepN: (n: number) => void;
  marbles: () => M[];
  results: () => { id: number; color: number; time: number }[];
  clearMarbles: () => void;
  spawnAtStart: () => number[];
  importJSON: (t: string) => void;
  setMode: (m: 'edit' | 'play') => void;
  setShape: (s: 'ball' | 'egg') => void;
  shape: () => 'ball' | 'egg';
  lookAt: (x: number, y: number, z: number, dist: number) => void;
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
  await page.evaluate(() => {
    window.__TEST__.setMode('play');
    window.__TEST__.pause();
  });
}

test('egg-shaped marble: selectable, spawns as an egg, tumbles down a slope track to the end', async ({ page }) => {
  // Eggs wobble and lose speed on flat pieces, so this track keeps descending: slope, steep slope, helix.
  await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 8, rot: 0 },
    { def: 'slope', cell: { x: 1, z: 0 }, level: 7, rot: 0 },
    { def: 'slope_steep', cell: { x: 3, z: 0 }, level: 6, rot: 0 },
    { def: 'helix', cell: { x: 5, z: 1 }, level: 4, rot: 0 },
    { def: 'slope', cell: { x: 7, z: 0 }, level: 3, rot: 0 },
    { def: 'end', cell: { x: 9, z: 0 }, level: 3, rot: 0 },
  ]);
  // Pick the egg from the play bar; the choice must apply to newly spawned marbles.
  await page.selectOption('#playbar select[data-play="shape"]', 'egg');
  expect(await page.evaluate(() => window.__TEST__.shape())).toBe('egg');
  await page.evaluate(() => {
    window.__TEST__.clearMarbles();
    window.__TEST__.spawnAtStart();
  });
  const ms = await page.evaluate(() => window.__TEST__.marbles());
  expect(ms).toHaveLength(1);
  expect(ms[0].shape).toBe('egg');

  const trail: string[] = [];
  let finished = 0;
  for (let s = 1; s <= 45 && finished === 0; s++) {
    await page.evaluate(() => window.__TEST__.stepN(120));
    const m = (await page.evaluate(() => window.__TEST__.marbles()))[0];
    if (m) trail.push(`${s}s (${m.x.toFixed(2)}, ${m.y.toFixed(2)}, ${m.z.toFixed(2)}) v=${Math.hypot(m.vx, m.vy, m.vz).toFixed(2)}`);
    if (s === 2 && m) {
      await page.evaluate(([x, y, z]) => window.__TEST__.lookAt(x, y, z, 2.5), [m.x, m.y, m.z] as const);
      await page.screenshot({ path: 'test-results/stage4c-egg.png' });
    }
    finished = await page.evaluate(() => window.__TEST__.results().length);
  }
  console.log(trail.join('\n'));
  expect(finished).toBe(1);

  // The choice survives a reload.
  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__TEST__.shape())).toBe('egg');
});
