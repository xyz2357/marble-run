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
};
declare global {
  interface Window { __TEST__: Seam }
}

async function waitReady(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
}

test('marble rolls down the ramp and settles on the ground', async ({ page }) => {
  await waitReady(page);
  await page.evaluate(() => window.__TEST__.pause());
  const start = await page.evaluate(() => window.__TEST__.marbles());
  expect(start).toHaveLength(1);
  const y0 = start[0].y;
  expect(y0).toBeGreaterThan(1.5);

  await page.screenshot({ path: 'test-results/stage0-start.png' });

  // 1 second of sim: marble must be lower and moving in +x (down the ramp)
  await page.evaluate(() => window.__TEST__.stepN(120));
  const mid = (await page.evaluate(() => window.__TEST__.marbles()))[0];
  expect(mid.y).toBeLessThan(y0 - 0.3);
  expect(mid.vx).toBeGreaterThan(0.5);
  // stays within the rails (z near 0)
  expect(Math.abs(mid.z)).toBeLessThan(0.3);
  await page.screenshot({ path: 'test-results/stage0-mid.png' });

  // t=2.5s: near the bottom of the ramp, fastest point
  await page.evaluate(() => window.__TEST__.stepN(180));
  const bottom = (await page.evaluate(() => window.__TEST__.marbles()))[0];
  const speedBottom = Math.hypot(bottom.vx, bottom.vy, bottom.vz);
  expect(speedBottom).toBeGreaterThan(2);

  // t=6.5s: rolling on the ground plane (no tunneling), still on the table, slowing down
  await page.evaluate(() => window.__TEST__.stepN(480));
  const end = (await page.evaluate(() => window.__TEST__.marbles()))[0];
  expect(end.y).toBeGreaterThan(0.1);
  expect(end.y).toBeLessThan(0.3);
  expect(Math.abs(end.x)).toBeLessThan(20);
  const speedEnd = Math.hypot(end.vx, end.vy, end.vz);
  expect(speedEnd).toBeLessThan(speedBottom);
  expect(Math.abs(end.vy)).toBeLessThan(0.05);
  await page.screenshot({ path: 'test-results/stage0-end.png' });
});

test('spawned marbles do not tunnel through the ramp at speed', async ({ page }) => {
  await waitReady(page);
  await page.evaluate(() => {
    window.__TEST__.pause();
    window.__TEST__.clearMarbles();
    // drop from high above the ramp deck
    window.__TEST__.spawnMarble(-1.5, 6, 0);
  });
  await page.evaluate(() => window.__TEST__.stepN(240));
  const m = (await page.evaluate(() => window.__TEST__.marbles()))[0];
  expect(m.y).toBeGreaterThan(0.1);
  await page.evaluate(() => window.__TEST__.setDebug(true));
  await page.screenshot({ path: 'test-results/stage0-debug.png' });
});
