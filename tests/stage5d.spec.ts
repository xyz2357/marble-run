import { test, expect, type Page } from '@playwright/test';

type M = { id: number; type: string; shape: string; x: number; y: number; z: number; vx: number; vy: number; vz: number };
type Placed = { def: string; cell: { x: number; z: number }; level: number; rot: number };
type Seam = {
  ready: boolean;
  pause: () => void;
  stepN: (n: number) => void;
  marbles: () => M[];
  results: () => { id: number; time: number }[];
  spawnAtStart: () => number[];
  clearMarbles: () => void;
  importJSON: (t: string) => void;
  setMode: (m: 'edit' | 'play') => void;
  openPortsScreen: () => unknown[];
  setShape: (id: string) => void;
  spawnMarble: (x: number, y: number, z: number) => number;
  lookAt: (x: number, y: number, z: number, d: number) => void;
  clearTrack: () => void;
  shape: () => string;
  marbleTypes: () => { id: string; name: string; density: number; restitution: number; friction: number }[];
};
declare global {
  interface Window {
    __TEST__: Seam;
  }
}

/**
 * A slope into the seesaw: the plank has to be swung out of the way, so the marble's mass and its
 * rolling losses both show. Times here repeat to the step, where a long flat run varies by a
 * tenth of a second between runs (the marble's random starting spin).
 */
const SEESAW: Placed[] = [
  { def: 'start', cell: { x: 0, z: 0 }, level: 8, rot: 0 },
  { def: 'slope', cell: { x: 1, z: 0 }, level: 7, rot: 0 },
  { def: 'seesaw', cell: { x: 4, z: 0 }, level: 6, rot: 0 },
  { def: 'end', cell: { x: 6, z: 0 }, level: 6, rot: 0 },
];

/** The jump pad throws the marble into its catch tray: the biggest drop a stock piece offers. */
const DROP: Placed[] = [
  { def: 'start', cell: { x: 0, z: 0 }, level: 3, rot: 0 },
  { def: 'jump', cell: { x: 1, z: 0 }, level: 2, rot: 0 },
  { def: 'end', cell: { x: 5, z: 0 }, level: 2, rot: 0 },
];

async function loadTrack(page: Page, pieces: Placed[], type: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  await page.evaluate((json) => window.__TEST__.importJSON(json), JSON.stringify({ version: 1, pieces }));
  expect(await page.evaluate(() => window.__TEST__.openPortsScreen()), 'all ports connected').toHaveLength(0);
  await page.evaluate((t) => {
    window.__TEST__.setShape(t);
    window.__TEST__.setMode('play');
    window.__TEST__.pause();
    window.__TEST__.clearMarbles();
    window.__TEST__.spawnAtStart();
  }, type);
  return errors;
}

/** Run one marble to the goal; returns its time plus how high it got after coming back down. */
async function runOne(page: Page, watchFrom: number) {
  let time = -1;
  let peakAfterLanding = -9;
  let descending = false;
  let prevVy = 0;
  let hops = 0;
  for (let i = 0; i < 900; i++) {
    await page.evaluate(() => window.__TEST__.stepN(3));
    const m = (await page.evaluate(() => window.__TEST__.marbles()))[0];
    if (!m) break;
    if (!descending && m.x > watchFrom && m.vy < -1) descending = true;
    if (descending) {
      peakAfterLanding = Math.max(peakAfterLanding, m.y);
      if (prevVy < -0.3 && m.vy > 0.3) hops++;
    }
    prevVy = m.vy;
    const r = await page.evaluate(() => window.__TEST__.results());
    if (r.length) {
      time = r[0].time;
      break;
    }
  }
  return { time, peakAfterLanding, hops };
}

test('the play bar offers every marble type and remembers the choice', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  const types = await page.evaluate(() => window.__TEST__.marbleTypes());
  expect(types.map((t) => t.id)).toEqual(['glass', 'steel', 'rubber', 'egg']);
  // Steel is the heavy one, rubber the grippy one; glass is unchanged from before there were types.
  expect(types.find((t) => t.id === 'steel')!.density).toBeGreaterThan(types.find((t) => t.id === 'glass')!.density * 2);
  expect(types.find((t) => t.id === 'rubber')!.friction).toBeGreaterThan(types.find((t) => t.id === 'glass')!.friction);
  const glass = types.find((t) => t.id === 'glass')!;
  expect({ density: glass.density, restitution: glass.restitution, friction: glass.friction }).toEqual({
    density: 2.5,
    restitution: 0.3,
    friction: 0.6,
  });

  await expect(page.locator('#playbar select[data-play="shape"] option')).toHaveCount(4);
  await page.evaluate(() => window.__TEST__.setMode('play'));
  await page.selectOption('#playbar select[data-play="shape"]', 'steel');
  expect(await page.evaluate(() => window.__TEST__.shape())).toBe('steel');
  const spawned = await page.evaluate(() => {
    window.__TEST__.clearMarbles();
    window.__TEST__.spawnAtStart();
    return window.__TEST__.marbles();
  });
  expect(spawned[0]?.type).toBe('steel');
  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__TEST__.shape()), 'the choice survives a reload').toBe('steel');
});

test('the three balls look different', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(() => {
    window.__TEST__.clearTrack();
    window.__TEST__.setMode('play');
    window.__TEST__.pause();
    window.__TEST__.clearMarbles();
    // One of each, side by side on the ground: swirled glass, anodised metal, matte rubber.
    ['glass', 'steel', 'rubber'].forEach((t, i) => {
      window.__TEST__.setShape(t);
      window.__TEST__.spawnMarble(i * 0.45, 0.4, 0);
    });
  });
  await page.evaluate(() => window.__TEST__.stepN(120));
  const ms = await page.evaluate(() => window.__TEST__.marbles());
  expect(ms.map((m) => m.type)).toEqual(['glass', 'steel', 'rubber']);
  await page.evaluate(() => window.__TEST__.lookAt(0.45, 0.15, 0, 1.2));
  await page.screenshot({ path: 'test-results/stage5d-marbles.png' });
});

test('steel wins the seesaw, rubber loses it', async ({ page }) => {
  // Density cancels out of a marble simply rolling downhill, so the three differ where a marble
  // has to shift something (the plank) and in how fast their rolling dies away.
  const times: Record<string, number> = {};
  for (const type of ['glass', 'steel', 'rubber']) {
    const errors = await loadTrack(page, SEESAW, type);
    const { time } = await runOne(page, 99);
    expect(time, `${type} reached the goal`).toBeGreaterThan(0);
    times[type] = time;
    expect(errors).toEqual([]);
  }
  console.log(`seesaw track: glass ${times.glass.toFixed(2)}s  steel ${times.steel.toFixed(2)}s  rubber ${times.rubber.toFixed(2)}s`);
  expect(times.steel, 'the heavy marble is fastest').toBeLessThan(times.glass * 0.98);
  expect(times.rubber, 'the grippy, heavily damped one is slowest').toBeGreaterThan(times.glass * 1.05);
});

test('rubber bounces on landing, glass and steel do not', async ({ page }) => {
  const peaks: Record<string, number> = {};
  const hopped: Record<string, number> = {};
  for (const type of ['glass', 'steel', 'rubber']) {
    const errors = await loadTrack(page, DROP, type);
    // Watch from x = 2.2, past the top of the pad's launch arc.
    const { time, peakAfterLanding, hops } = await runOne(page, 2.2);
    expect(time, `${type} completes a jump-pad track`).toBeGreaterThan(0);
    peaks[type] = peakAfterLanding;
    hopped[type] = hops;
    expect(errors).toEqual([]);
  }
  console.log(
    `landing rebound: glass ${peaks.glass.toFixed(2)} (${hopped.glass} hops)  steel ${peaks.steel.toFixed(2)} (${hopped.steel})  rubber ${peaks.rubber.toFixed(2)} (${hopped.rubber})`,
  );
  expect(peaks.rubber, 'rubber comes back up noticeably higher').toBeGreaterThan(peaks.glass + 0.1);
  expect(peaks.steel, 'steel lands dead, like glass').toBeLessThan(peaks.glass + 0.1);
});
