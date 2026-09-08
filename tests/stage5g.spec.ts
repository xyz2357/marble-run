import { test, expect, type Page } from '@playwright/test';

type M = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };
type Placed = { def: string; cell: { x: number; z: number }; level: number; rot: number };
type Seam = {
  ready: boolean;
  pause: () => void;
  stepN: (n: number) => void;
  marbles: () => M[];
  results: () => { time: number }[];
  spawnBurst: (n: number, interval?: number) => void;
  clearMarbles: () => void;
  importJSON: (t: string) => void;
  setMode: (m: 'edit' | 'play') => void;
  openPortsScreen: () => unknown[];
  lookAt: (x: number, y: number, z: number, d: number) => void;
  paletteIds: () => string[];
  variants: () => string[];
  select: (id: string | null) => void;
  setToolMode: (m: 'chain' | 'free') => void;
  setShape: (id: string) => void;
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
    window.__TEST__.clearMarbles();
  });
  return errors;
}

/** Step until `want` marbles finish, tracking how high and how fast they got. */
async function run(page: Page, want: number, seconds = 60) {
  let peakY = -99;
  let maxSpeed = 0;
  let done = 0;
  for (let i = 0; i < seconds * 20; i++) {
    await page.evaluate(() => window.__TEST__.stepN(6));
    for (const m of await page.evaluate(() => window.__TEST__.marbles())) {
      peakY = Math.max(peakY, m.y);
      maxSpeed = Math.max(maxSpeed, Math.hypot(m.vx, m.vy, m.vz));
    }
    done = (await page.evaluate(() => window.__TEST__.results())).length;
    if (done >= want) break;
  }
  return { done, peakY, maxSpeed };
}

/** start(level 5) -> loop(level 0) -> end. The loop's own ramp supplies the speed. */
const LOOP_RIG: Placed[] = [
  { def: 'start', cell: { x: 0, z: 0 }, level: 5, rot: 0 },
  { def: 'loop', cell: { x: 1, z: 0 }, level: 0, rot: 0 },
  { def: 'end', cell: { x: 6, z: 1 }, level: 0, rot: 0 },
];

test('the loop carries marbles over the top straight off the start piece', async ({ page }) => {
  // The whole point of the built-in ramp: a rolling sphere needs 2.7x the loop radius of drop to
  // stay on at the top, and the piece supplies it, so the loop does not depend on what feeds it.
  // Placed straight after the start, with no drop in front of it at all, it still gets round.
  const errors = await loadTrack(page, LOOP_RIG);
  await page.evaluate(() => window.__TEST__.spawnBurst(3, 1.5));
  const { done, peakY, maxSpeed } = await run(page, 3);
  console.log(`loop: ${done}/3 finished, peak y ${peakY.toFixed(2)}, max speed ${maxSpeed.toFixed(2)}`);
  // The loop's top is at local y 1.55, so a marble that gets round passes above 1.5.
  expect(peakY, 'a marble went over the top of the loop').toBeGreaterThan(1.5);
  expect(done, 'all three got round and out').toBe(3);
  // Nothing is driven here - a marble faster than free-fall from the entry would mean a bug.
  expect(maxSpeed).toBeLessThan(7);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.__TEST__.lookAt(4, 1.2, 0.5, 4.5));
  await page.screenshot({ path: 'test-results/stage5g-loop.png' });
});

test('a marble that enters the loop slowly still leaves it', async ({ page }) => {
  // A loop's foot is a dip with the track rising both ways, so a marble that cannot make the top
  // would be trapped there forever. The ramp is what stops that happening; check it holds when
  // the marble arrives with nothing behind it.
  const errors = await loadTrack(page, LOOP_RIG);
  await page.evaluate(() => window.__TEST__.spawnBurst(1));
  const { done } = await run(page, 1, 40);
  expect(done, 'the single slow marble still came out').toBe(1);
  expect(errors).toEqual([]);
});

test('the big wheel takes marbles down eight levels', async ({ page }) => {
  // Same mechanism as the small wheel, twice the radius: in port at local (-1.5, 4).
  const errors = await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 8, rot: 0 },
    { def: 'wheel_big', cell: { x: 2, z: 0 }, level: 0, rot: 0 },
    { def: 'end', cell: { x: 5, z: 0 }, level: 0, rot: 0 },
  ]);
  await page.evaluate(() => window.__TEST__.spawnBurst(3, 2));
  const { done, maxSpeed } = await run(page, 3);
  const times = (await page.evaluate(() => window.__TEST__.results())).map((r) => r.time);
  console.log(`big wheel: ${done}/3 in ${times.map((t) => t.toFixed(1)).join(', ')}s, max speed ${maxSpeed.toFixed(2)}`);
  expect(done, 'all three rode it down').toBe(3);
  // A ride, not a drop: free fall down 4 m would take 0.9s.
  expect(Math.min(...times)).toBeGreaterThan(3);
  // A kinematic wheel that traps a marble against the casing throws it out at 4-9 m/s; the
  // marble's own fall from the entry deck only reaches about 5.
  expect(maxSpeed).toBeLessThan(6);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.__TEST__.lookAt(2, 2.25, 0, 7));
  await page.screenshot({ path: 'test-results/stage5g-bigwheel.png' });
});

/** start -> steep slope -> screw (in port local (-2.5, 1.0), out at (3.5, 2.5)) -> end. */
const SCREW_RIG: Placed[] = [
  { def: 'start', cell: { x: 0, z: 0 }, level: 3, rot: 0 },
  { def: 'slope_steep', cell: { x: 1, z: 0 }, level: 2, rot: 0 },
  { def: 'screw', cell: { x: 4, z: 0 }, level: 0, rot: 0 },
  { def: 'end', cell: { x: 8, z: 0 }, level: 5, rot: 0 },
];

// The one piece that gains height without a lift car, and it has to do it for every ball. The
// inlet window's size is what decides this: too small and a marble that queued behind another
// arrives differently, misses it and lands on the floor - which is what "it stays at the bottom"
// looks like. Rubber was the one that showed it up; at 46 degrees it managed 2 of 3, at 70 it is
// fine. Marbles are spaced out here so this tests the lift itself; queued up three at a time it
// still delivers 26 marbles out of 27.
for (const type of ['glass', 'steel', 'rubber']) {
  test(`the screw carries ${type} marbles up, one after another`, async ({ page }) => {
    const errors = await loadTrack(page, SCREW_RIG);
    await page.evaluate((t) => {
      window.__TEST__.setShape(t);
      window.__TEST__.spawnBurst(2, 4);
    }, type);
    const { done, peakY, maxSpeed } = await run(page, 2, 150);
    const times = (await page.evaluate(() => window.__TEST__.results())).map((r) => r.time);
    console.log(`screw ${type}: ${done}/2 in ${times.map((t) => t.toFixed(0)).join(', ')}s, peak y ${peakY.toFixed(2)}, max speed ${maxSpeed.toFixed(2)}`);
    expect(done, 'both were carried up').toBe(2);
    // The entry deck is at y = 1.0; anything above 2.6 was lifted there by the screw.
    expect(peakY, 'marbles ended up well above where they went in').toBeGreaterThan(2.6);
    // Carried, not thrown. The blade's rim only moves at 1.4 m/s; the rest is the 0.4 m drop out
    // of the underside opening at the top and the run down the exit deck.
    expect(maxSpeed, 'nothing is flung').toBeLessThan(7);
    expect(Math.min(...times), 'a slow climb, not a drop').toBeGreaterThan(8);
    expect(errors).toEqual([]);
    if (type === 'glass') {
      await page.evaluate(() => window.__TEST__.lookAt(4.5, 1.6, 0, 6));
      await page.screenshot({ path: 'test-results/stage5g-screw.png' });
    }
  });
}

test('the loop is its own palette entry and the big wheel joins the wheel family', async ({ page }) => {
  await loadTrack(page, LOOP_RIG);
  const palette = await page.evaluate(() => window.__TEST__.paletteIds());
  expect(palette).toContain('loop');
  expect(palette).toContain('screw');
  expect(palette, 'the big wheel folds into the wheel entry').not.toContain('wheel_big');
  await page.evaluate(() => {
    window.__TEST__.setMode('edit');
    window.__TEST__.setToolMode('free');
    window.__TEST__.select('wheel');
  });
  expect(await page.evaluate(() => window.__TEST__.variants())).toEqual(['wheel', 'wheel_fast', 'wheel_big']);
});
