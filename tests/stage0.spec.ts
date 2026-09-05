import { test, expect, type Page } from '@playwright/test';

type Seam = {
  ready: boolean;
  pause: () => void;
  stepN: (n: number) => void;
  spawnMarble: (x: number, y: number, z: number) => number;
  clearMarbles: () => void;
  marbles: () => { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }[];
  stepCount: () => number;
  setDebug: (on: boolean) => void;
  lookAt: (x: number, y: number, z: number, dist: number) => void;
};
declare global {
  interface Window {
    __TEST__: Seam;
  }
}

async function waitReady(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(() => {
    window.__TEST__.pause();
    window.__TEST__.clearMarbles();
  });
}

test('physics: a dropped marble lands on the ground and comes to rest', async ({ page }) => {
  await waitReady(page);
  // Empty corner of the table, away from the demo track.
  await page.evaluate(() => window.__TEST__.spawnMarble(25, 2, 25));
  await page.evaluate(() => window.__TEST__.stepN(120 * 4));
  const m = (await page.evaluate(() => window.__TEST__.marbles()))[0];
  expect(m.y).toBeGreaterThan(0.12);
  expect(m.y).toBeLessThan(0.18); // resting: center = radius above the ground
  expect(Math.hypot(m.vx, m.vy, m.vz)).toBeLessThan(0.05);
  expect(Math.hypot(m.x - 25, m.z - 25)).toBeLessThan(0.05);
});

test('physics: a fast marble does not tunnel through the ground (CCD)', async ({ page }) => {
  await waitReady(page);
  await page.evaluate(() => window.__TEST__.spawnMarble(-25, 30, -25));
  await page.evaluate(() => window.__TEST__.stepN(120 * 6));
  const m = (await page.evaluate(() => window.__TEST__.marbles()))[0];
  expect(m).toBeDefined();
  expect(m.y).toBeGreaterThan(0.1);
  await page.evaluate(() => {
    window.__TEST__.setDebug(true);
    window.__TEST__.lookAt(-25, 0.2, -25, 3);
  });
  await page.screenshot({ path: 'test-results/stage0-debug.png' });
});

test('physics: fixed step count is deterministic', async ({ page }) => {
  await waitReady(page);
  const before = await page.evaluate(() => window.__TEST__.stepCount());
  await page.evaluate(() => window.__TEST__.stepN(37));
  const after = await page.evaluate(() => window.__TEST__.stepCount());
  expect(after - before).toBe(37);
});
