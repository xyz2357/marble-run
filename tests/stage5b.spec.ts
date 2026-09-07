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
  pieces: () => Placed[];
  openPortsScreen: () => { piece: string; kind: string; wx: number; wy: number; wz: number }[];
  setMode: (m: 'edit' | 'play') => void;
  loadDemo: (which?: number) => void;
  demos: () => string[];
  frameTrack: () => void;
};
declare global {
  interface Window {
    __TEST__: Seam;
  }
}

/**
 * Every demo, with a budget generous enough for the slow mechanisms. Measured run times for
 * three marbles: 1/4/5 finish in under 20 s, 3 and 6 in about 30 s, 2 waits on the ten-level
 * lift. The budgets are simulated seconds, not wall clock.
 */
const DEMOS = [
  { n: 1, name: '基础', deliver: 3, seconds: 60 },
  { n: 2, name: '机关', deliver: 3, seconds: 150 },
  { n: 3, name: '跳台', deliver: 3, seconds: 90 },
  { n: 4, name: '变道与管道', deliver: 3, seconds: 60 },
  { n: 5, name: '快慢对决', deliver: 3, seconds: 60 },
  { n: 6, name: '规格巡礼', deliver: 3, seconds: 90 },
  { n: 7, name: '环形与大水车', deliver: 3, seconds: 90 },
];

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  return errors;
}

for (const d of DEMOS) {
  test(`demo ${d.n} (${d.name}) is closed and delivers marbles`, async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate((n) => window.__TEST__.loadDemo(n), d.n);
    const pieces = await page.evaluate(() => window.__TEST__.pieces());
    expect(pieces.length, 'demo built some pieces').toBeGreaterThan(5);
    const open = await page.evaluate(() => window.__TEST__.openPortsScreen());
    expect(open.map((p) => `${p.piece}@${p.wx},${p.wy},${p.wz}`), 'every port is connected').toEqual([]);

    await page.evaluate(() => {
      window.__TEST__.setMode('play');
      window.__TEST__.pause();
      window.__TEST__.spawnBurst(2, 1.5);
    });
    let done = false;
    for (let i = 0; i < d.seconds * 10 && !done; i++) {
      await page.evaluate(() => window.__TEST__.stepN(12));
      done = (await page.evaluate(() => window.__TEST__.results().length)) >= d.deliver;
    }
    const results = await page.evaluate(() => window.__TEST__.results());
    const stuck = await page.evaluate(() => window.__TEST__.marbles());
    console.log(
      `demo ${d.n} ${d.name}: ${pieces.length} pieces, ${results.length}/${d.deliver} finished` +
        (done ? '' : `, stuck at ${JSON.stringify(stuck.map((m) => [+m.x.toFixed(1), +m.y.toFixed(1), +m.z.toFixed(1)]))}`),
    );
    expect(done, `${d.deliver} marbles reached a goal`).toBe(true);
    expect(errors).toEqual([]);

    await page.evaluate(() => window.__TEST__.frameTrack());
    await page.screenshot({ path: `test-results/stage5b-demo${d.n}.png` });
  });
}

test('the demo picker lists every preset and loads one', async ({ page }) => {
  await boot(page);
  const names = await page.evaluate(() => window.__TEST__.demos());
  expect(names).toHaveLength(DEMOS.length);
  const select = page.locator('#demo-select');
  await expect(select).toBeVisible();
  // One option per demo plus the "示例…" placeholder.
  await expect(select.locator('option')).toHaveCount(DEMOS.length + 1);
  await page.evaluate(() => window.__TEST__.loadDemo(1));
  expect(await page.evaluate(() => window.__TEST__.pieces().some((p) => p.def === 'merge'))).toBe(false);
  // Replacing a non-empty track asks for confirmation first.
  page.on('dialog', (d) => d.accept());
  await select.selectOption('5');
  const after = await page.evaluate(() => window.__TEST__.pieces());
  expect(after.some((p) => p.def === 'merge'), 'picking demo 5 loaded it - only it has the merge').toBe(true);
  // The picker resets so the same demo can be chosen again.
  await expect(select).toHaveValue('');
});
