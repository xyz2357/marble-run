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
  openPortsScreen: () => unknown[];
  lookAt: (x: number, y: number, z: number, dist: number) => void;
  paletteIds: () => string[];
};
declare global {
  interface Window {
    __TEST__: Seam;
  }
}

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
  });
  return errors;
}

/** Step in 0.05 s slices for up to `seconds`, collecting marble states; stops when `count` finished. */
async function run(page: Page, seconds: number, count: number) {
  const samples: M[][] = [];
  for (let i = 0; i < seconds * 20; i++) {
    await page.evaluate(() => window.__TEST__.stepN(6));
    samples.push(await page.evaluate(() => window.__TEST__.marbles()));
    if ((await page.evaluate(() => window.__TEST__.results().length)) >= count) return { samples, done: true };
  }
  return { samples, done: false };
}

const speed = (m: M) => Math.hypot(m.vx, m.vy, m.vz);

/**
 * start(0,0,L3) -> the piece under test at (1,0,L2), which spans x = 0.5 .. 2.5 and drops
 * one level -> straight(3,0,L2) -> end(4,0,L2).
 */
function surfaceRig(mid: string): Placed[] {
  return [
    { def: 'start', cell: { x: 0, z: 0 }, level: 3, rot: 0 },
    { def: mid, cell: { x: 1, z: 0 }, level: 2, rot: 0 },
    { def: 'straight', cell: { x: 3, z: 0 }, level: 2, rot: 0 },
    { def: 'end', cell: { x: 4, z: 0 }, level: 2, rot: 0 },
  ];
}

/** Speed of the first marble at the last sample before it left the piece under test. */
async function exitSpeed(page: Page, mid: string) {
  const errors = await loadTrack(page, surfaceRig(mid));
  const { samples, done } = await run(page, 20, 1);
  const path = samples.map((s) => s[0]).filter(Boolean);
  const onPiece = path.filter((m) => m.x > 1.5 && m.x < 2.5);
  expect(errors).toEqual([]);
  expect(onPiece.length, `${mid}: marble crossed the piece`).toBeGreaterThan(0);
  return { v: speed(onPiece[onPiece.length - 1]), done };
}

test('ice leaves the marble faster than wood; the brake leaves it far slower', async ({ page }) => {
  const wood = await exitSpeed(page, 'slope');
  const ice = await exitSpeed(page, 'ice');
  const brake = await exitSpeed(page, 'brake');
  console.log(`exit speed  slope=${wood.v.toFixed(2)}  ice=${ice.v.toFixed(2)}  brake=${brake.v.toFixed(2)} m/s`);
  // Every surface still delivers the marble to the goal.
  expect(wood.done && ice.done && brake.done, 'all three surfaces deliver').toBe(true);
  // Sliding puts the whole drop into forward speed instead of splitting it with spin.
  expect(ice.v).toBeGreaterThan(wood.v * 1.05);
  // The washboard eats at least a third of the speed.
  expect(brake.v).toBeLessThan(wood.v * 0.67);
  await page.evaluate(() => window.__TEST__.lookAt(1.5, 1.3, 0, 3.5));
  await page.screenshot({ path: 'test-results/stage5a-brake.png' });
});

test('brake does not stall a train of marbles', async ({ page }) => {
  const errors = await loadTrack(page, surfaceRig('brake'));
  // setMode('play') already released one; three more follow it closely.
  await page.evaluate(() => window.__TEST__.spawnBurst(3, 1.5));
  const { done } = await run(page, 30, 4);
  expect(done, 'all four marbles reached the goal').toBe(true);
  expect(errors).toEqual([]);
});

test('tube carries marbles through its bore, level and sloped', async ({ page }) => {
  const errors = await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 4, rot: 0 },
    { def: 'tube_slope', cell: { x: 1, z: 0 }, level: 3, rot: 0 },
    { def: 'tube', cell: { x: 3, z: 0 }, level: 3, rot: 0 },
    { def: 'slope', cell: { x: 4, z: 0 }, level: 2, rot: 0 },
    { def: 'end', cell: { x: 6, z: 0 }, level: 2, rot: 0 },
  ]);
  await page.evaluate(() => window.__TEST__.spawnBurst(3, 1.5));
  const { samples, done } = await run(page, 30, 4);
  const path = samples.map((s) => s[0]).filter(Boolean);
  // Inside the bore the marble rides on the tube floor, level with the deck it came from
  // (deck at y = 1.5 for the level tube, marble centre 0.15 above it).
  const inTube = path.filter((m) => m.x > 3 && m.x < 3.4);
  expect(inTube.length, 'marble was seen inside the level tube').toBeGreaterThan(0);
  for (const m of inTube) {
    expect(m.y, 'marble rides the bore floor, not sunk through it or on top of the shell').toBeGreaterThan(1.55);
    expect(m.y).toBeLessThan(1.85);
  }
  expect(done, 'all four marbles reached the goal').toBe(true);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.__TEST__.lookAt(2.2, 1.7, 0, 3.5));
  await page.screenshot({ path: 'test-results/stage5a-tube.png' });
});

for (const [id, sign] of [
  ['scurve_r', 1],
  ['scurve_l', -1],
] as const) {
  test(`${id} shifts the track one cell sideways and keeps marbles on it`, async ({ page }) => {
    const errors = await loadTrack(page, [
      { def: 'start', cell: { x: 0, z: 0 }, level: 3, rot: 0 },
      { def: 'slope', cell: { x: 1, z: 0 }, level: 2, rot: 0 },
      { def: id, cell: { x: 3, z: 0 }, level: 2, rot: 0 },
      { def: 'end', cell: { x: 5, z: sign }, level: 2, rot: 0 },
    ]);
    await page.evaluate(() => window.__TEST__.spawnBurst(3, 1.5));
    const { samples, done } = await run(page, 30, 4);
    const path = samples.map((s) => s[0]).filter(Boolean);
    // The marble crossed the bend and ended up a full cell to the side.
    const onBend = path.filter((m) => m.x > 2.5 && m.x < 4.5);
    expect(onBend.length).toBeGreaterThan(0);
    for (const m of onBend) expect(Math.abs(m.y - 1.15), 'stays on the deck through the bend').toBeLessThan(0.25);
    expect(Math.sign(path[path.length - 1].z)).toBe(sign);
    expect(done, 'all four marbles reached the goal').toBe(true);
    expect(errors).toEqual([]);
    if (sign === 1) {
      await page.evaluate(() => window.__TEST__.lookAt(3.5, 1.2, 0.5, 4));
      await page.screenshot({ path: 'test-results/stage5a-scurve.png' });
    }
  });
}

test('palette lists the new families once each', async ({ page }) => {
  await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 3, rot: 0 },
    { def: 'slope', cell: { x: 1, z: 0 }, level: 2, rot: 0 },
    { def: 'end', cell: { x: 3, z: 0 }, level: 2, rot: 0 },
  ]);
  const palette = await page.evaluate(() => window.__TEST__.paletteIds());
  expect(palette).toContain('scurve_r');
  expect(palette).toContain('ice');
  expect(palette).toContain('tube');
  expect(palette).not.toContain('scurve_l');
  expect(palette).not.toContain('brake');
  expect(palette).not.toContain('tube_slope');
});
