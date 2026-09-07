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
  spawnAtStart: () => number[];
  clearMarbles: () => void;
  importJSON: (t: string) => void;
  setMode: (m: 'edit' | 'play') => void;
  openPortsScreen: () => unknown[];
  lookAt: (x: number, y: number, z: number, dist: number) => void;
  pick: (i: number | null) => void;
  picked: () => Placed | null;
  variants: () => string[];
  setVariant: (id: string) => boolean;
  clearTrack: () => void;
  setToolMode: (m: 'chain' | 'free') => void;
  setLevel: (n: number) => void;
  select: (id: string | null) => void;
  candidate: () => { valid: boolean } | null;
  pieces: () => Placed[];
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

test('jump pad clears its own stop bar and throws a real arc', async ({ page }) => {
  // The pad spans x = 0.5 .. 4.5 with its origin at (1, 1, 0); the catch tray is at z = 0.
  const errors = await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 3, rot: 0 },
    { def: 'jump', cell: { x: 1, z: 0 }, level: 2, rot: 0 },
    { def: 'end', cell: { x: 5, z: 0 }, level: 2, rot: 0 },
  ]);
  await page.evaluate(() => window.__TEST__.spawnBurst(3, 1.5));
  let launch: M | null = null;
  let peak = -9;
  let sideways = 0;
  let done = false;
  for (let i = 0; i < 600 && !done; i++) {
    await page.evaluate(() => window.__TEST__.stepN(6));
    for (const m of await page.evaluate(() => window.__TEST__.marbles())) {
      if (!launch && m.vy > 2 && m.x < 1.5) launch = m;
      if (m.x > 1.2 && m.x < 4.6) {
        peak = Math.max(peak, m.y - 1);
        sideways = Math.max(sideways, Math.abs(m.z));
      }
    }
    done = (await page.evaluate(() => window.__TEST__.results().length)) >= 3;
  }
  console.log(`jump: launch=(${launch?.vx.toFixed(2)}, ${launch?.vy.toFixed(2)}) peak=${peak.toFixed(2)} sideways=${sideways.toFixed(2)}`);
  expect(launch, 'the pad fired').toBeTruthy();
  // The launch used to graze the stop bar and lose two thirds of its forward speed in one step;
  // the marble must keep enough of it to carry down the tray.
  expect(launch!.vx, 'keeps its forward speed past the stop bar').toBeGreaterThan(1.4);
  expect(peak, 'a real arc, not a vertical pop').toBeGreaterThan(1.1);
  // ...but not so high that it leaves the 3 levels the piece reserves above its anchor.
  expect(peak).toBeLessThan(1.5);
  // Firing only once the marble has settled keeps the launch straight down the tray.
  expect(sideways, 'no sideways drift out of the catch tray').toBeLessThan(0.25);
  expect(done, 'all three marbles reached the goal').toBe(true);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.__TEST__.lookAt(2.6, 1.9, 0, 5));
  await page.screenshot({ path: 'test-results/stage5c-jump-arc.png' });
});

test('a lift cannot be placed at level 0, where the ground would cut through its shaft', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(() => {
    window.__TEST__.clearTrack();
    window.__TEST__.setToolMode('free');
    window.__TEST__.select('lift6');
  });
  // The shaft hangs one level below the anchor, so level 0 is underground and level 1 is not.
  await page.evaluate(() => window.__TEST__.setLevel(0));
  await page.mouse.move(640, 420);
  expect((await page.evaluate(() => window.__TEST__.candidate()))?.valid, 'level 0 is rejected').toBe(false);
  await page.evaluate(() => window.__TEST__.setLevel(1));
  await page.mouse.move(640, 420);
  expect((await page.evaluate(() => window.__TEST__.candidate()))?.valid, 'level 1 is allowed').toBe(true);
});

test('lift shaft finish is a family variant: glass and solid both deliver', async ({ page }) => {
  const errors = await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 2, rot: 0 },
    { def: 'slope_steep', cell: { x: 1, z: 0 }, level: 1, rot: 0 },
    { def: 'lift6_solid', cell: { x: 2, z: 0 }, level: 1, rot: 0 },
    { def: 'slope', cell: { x: 4, z: 0 }, level: 6, rot: 0 },
    { def: 'end', cell: { x: 6, z: 0 }, level: 6, rot: 0 },
  ]);
  await page.evaluate(() => window.__TEST__.spawnBurst(2, 2));
  let done = false;
  for (let i = 0; i < 900 && !done; i++) {
    await page.evaluate(() => window.__TEST__.stepN(12));
    done = (await page.evaluate(() => window.__TEST__.results().length)) >= 2;
  }
  expect(done, 'the solid-shaft lift delivers just like the glass one').toBe(true);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.__TEST__.lookAt(2.5, 2, 0, 6));
  await page.screenshot({ path: 'test-results/stage5c-lift-solid.png' });
});

test('V switches a placed lift between glass and solid without moving it', async ({ page }) => {
  await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 2, rot: 0 },
    { def: 'slope_steep', cell: { x: 1, z: 0 }, level: 1, rot: 0 },
    { def: 'lift6', cell: { x: 2, z: 0 }, level: 1, rot: 0 },
    { def: 'slope', cell: { x: 4, z: 0 }, level: 6, rot: 0 },
    { def: 'end', cell: { x: 6, z: 0 }, level: 6, rot: 0 },
  ]);
  await page.evaluate(() => window.__TEST__.setMode('edit'));
  await page.evaluate(() => window.__TEST__.pick(2));
  // Eight members: four heights, each with a glass and a solid shaft, paired.
  expect(await page.evaluate(() => window.__TEST__.variants())).toEqual([
    'lift4', 'lift4_solid', 'lift6', 'lift6_solid', 'lift8', 'lift8_solid', 'lift10', 'lift10_solid',
  ]);
  const before = await page.evaluate(() => window.__TEST__.picked());
  expect(await page.evaluate(() => window.__TEST__.setVariant('lift6_solid'))).toBe(true);
  const after = await page.evaluate(() => window.__TEST__.picked());
  expect(after!.def).toBe('lift6_solid');
  // Same cell, level and rotation: only the finish changed.
  expect({ ...after!, def: '' }).toEqual({ ...before!, def: '' });
  // The track is still closed, so swapping the finish did not move any port.
  expect(await page.evaluate(() => window.__TEST__.openPortsScreen())).toHaveLength(0);
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
