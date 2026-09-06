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
  spawnAtStart: () => number[];
  clearMarbles: () => void;
  importJSON: (t: string) => void;
  setMode: (m: 'edit' | 'play') => void;
  pieces: () => Placed[];
  ports: () => { piece: string; x: number; y: number; z: number; dx: number; dz: number; kind: string }[];
  openPortsScreen: () => unknown[];
  lookAt: (x: number, y: number, z: number, dist: number) => void;
  frameTrack: () => void;
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
  // Every port must be paired (the tracks below are closed chains).
  const open = await page.evaluate(() => window.__TEST__.openPortsScreen());
  expect(open, 'all ports connected').toHaveLength(0);
  await page.evaluate(() => {
    window.__TEST__.setMode('play');
    window.__TEST__.pause();
  });
  return errors;
}

async function runUntilFinished(page: Page, count: number, maxSeconds: number) {
  for (let s = 0; s < maxSeconds; s++) {
    await page.evaluate(() => window.__TEST__.stepN(120));
    if ((await page.evaluate(() => window.__TEST__.results().length)) >= count) return true;
  }
  return false;
}

test('splitter alternates marbles between its two exits', async ({ page }) => {
  const errors = await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 6, rot: 0 },
    { def: 'slope', cell: { x: 1, z: 0 }, level: 5, rot: 0 },
    { def: 'splitter', cell: { x: 3, z: 0 }, level: 4, rot: 0 },
    { def: 'end', cell: { x: 6, z: 1 }, level: 4, rot: 0 },
    { def: 'end', cell: { x: 6, z: -1 }, level: 4, rot: 0 },
  ]);
  // A mechanical toggle needs the previous marble to clear the flap first: space them 1.2 s apart.
  await page.evaluate(() => {
    window.__TEST__.clearMarbles();
    window.__TEST__.spawnBurst(4, 1.2);
  });
  const trail: string[] = [];
  let done = false;
  for (let s = 0; s < 30 && !done; s++) {
    await page.evaluate(() => window.__TEST__.stepN(60));
    const ms = await page.evaluate(() => window.__TEST__.marbles());
    trail.push(`${(s * 0.5).toFixed(1)}s ` + ms.map((m) => `(${m.x.toFixed(2)}, ${m.y.toFixed(2)}, ${m.z.toFixed(2)}) v=${Math.hypot(m.vx, m.vy, m.vz).toFixed(2)}`).join('  '));
    done = (await page.evaluate(() => window.__TEST__.results().length)) >= 4;
  }
  console.log(['splitter', ...trail].join('\n'));
  expect(done).toBe(true);
  const marbles = await page.evaluate(() => window.__TEST__.marbles());
  marbles.sort((a, b) => a.id - b.id);
  const sides = marbles.map((m) => Math.sign(m.z));
  console.log('splitter sides', JSON.stringify(sides), JSON.stringify(marbles.map((m) => [m.x.toFixed(2), m.z.toFixed(2)])));
  expect(sides).toEqual([1, -1, 1, -1]);
  await page.evaluate(() => window.__TEST__.lookAt(4.5, 2.5, 0, 6));
  await page.screenshot({ path: 'test-results/stage4-splitter.png' });
  expect(errors).toEqual([]);
});

test('merge joins two entries into one exit', async ({ page }) => {
  await loadTrack(page, [
    // One branch is a cell longer so the two marbles do not meet head-on at the fork.
    { def: 'start', cell: { x: 5, z: 1 }, level: 4, rot: 2 },
    { def: 'straight', cell: { x: 4, z: 1 }, level: 4, rot: 0 },
    { def: 'straight', cell: { x: 3, z: 1 }, level: 4, rot: 0 },
    { def: 'start', cell: { x: 3, z: -1 }, level: 4, rot: 2 },
    { def: 'merge', cell: { x: 0, z: 0 }, level: 3, rot: 0 },
    { def: 'slope', cell: { x: -1, z: 0 }, level: 2, rot: 2 },
    { def: 'end', cell: { x: -3, z: 0 }, level: 2, rot: 2 },
  ]);
  expect(await page.evaluate(() => window.__TEST__.marbles().length)).toBe(2);
  const trail: string[] = [];
  let done = false;
  for (let s = 0; s < 40 && !done; s++) {
    await page.evaluate(() => window.__TEST__.stepN(60));
    const ms = await page.evaluate(() => window.__TEST__.marbles());
    trail.push(`${(s * 0.5).toFixed(1)}s ` + ms.map((m) => `(${m.x.toFixed(2)}, ${m.y.toFixed(2)}, ${m.z.toFixed(2)}) v=${Math.hypot(m.vx, m.vy, m.vz).toFixed(2)}`).join('  '));
    done = (await page.evaluate(() => window.__TEST__.results().length)) >= 2;
  }
  console.log(['merge', ...trail].join('\n'));
  expect(done).toBe(true);
  await page.evaluate(() => window.__TEST__.lookAt(1, 2, 0, 6));
  await page.screenshot({ path: 'test-results/stage4-merge.png' });
});

test('vortex: marble orbits at least one full lap before dropping through, then exits', async ({ page }) => {
  await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 10, rot: 0 },
    { def: 'slope', cell: { x: 1, z: 0 }, level: 9, rot: 0 },
    { def: 'slope', cell: { x: 3, z: 0 }, level: 8, rot: 0 },
    { def: 'vortex', cell: { x: 7, z: 0 }, level: 8, rot: 0 },
    { def: 'straight', cell: { x: 10, z: 0 }, level: 4, rot: 0 },
    { def: 'end', cell: { x: 11, z: 0 }, level: 4, rot: 0 },
  ]);
  const cx = 7;
  const cz = 0;
  const cy = 4;
  let inBowl = false;
  let angleAcc = 0;
  let lastAngle = 0;
  let bowlTime = 0;
  let minY = Infinity;
  const trail: string[] = [];
  for (let step = 0; step < 120 * 40; step += 6) {
    await page.evaluate(() => window.__TEST__.stepN(6));
    const m = (await page.evaluate(() => window.__TEST__.marbles()))[0];
    if (!m) break;
    const r = Math.hypot(m.x - cx, m.z - cz);
    const y = m.y - cy;
    const ang = Math.atan2(m.z - cz, m.x - cx);
    if (!inBowl && r < 1.75 && y < 0.3 && y > -1.2) {
      inBowl = true;
      lastAngle = ang;
    }
    if (inBowl && y > -1.3) {
      let d = ang - lastAngle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      angleAcc += d;
      lastAngle = ang;
      bowlTime += 6 / 120;
      minY = Math.min(minY, y);
      if (step % 60 === 0) trail.push(`${(step / 120).toFixed(1)}s r=${r.toFixed(2)} y=${y.toFixed(2)} v=${Math.hypot(m.vx, m.vy, m.vz).toFixed(2)}`);
    }
    if (inBowl && y < -1.3) break;
  }
  console.log(`vortex: bowlTime=${bowlTime.toFixed(2)} laps=${(Math.abs(angleAcc) / (2 * Math.PI)).toFixed(2)} minY=${minY.toFixed(2)}\n${trail.join('\n')}`);
  expect(inBowl).toBe(true);
  expect(Math.abs(angleAcc)).toBeGreaterThan(2 * Math.PI);
  expect(await runUntilFinished(page, 1, 30)).toBe(true);
  await page.evaluate(() => window.__TEST__.lookAt(7, 4, 0, 6));
  await page.screenshot({ path: 'test-results/stage4-vortex.png' });
});

test('seesaw tips under the marble and delivers it to the exit', async ({ page }) => {
  await loadTrack(page, [
    { def: 'start', cell: { x: 0, z: 0 }, level: 3, rot: 0 },
    { def: 'seesaw', cell: { x: 2, z: 0 }, level: 2, rot: 0 },
    { def: 'end', cell: { x: 4, z: 0 }, level: 2, rot: 0 },
  ]);
  const trail: string[] = [];
  let finished = false;
  for (let s = 0; s < 15 && !finished; s++) {
    await page.evaluate(() => window.__TEST__.stepN(60));
    const m = (await page.evaluate(() => window.__TEST__.marbles()))[0];
    if (m) trail.push(`${(s * 0.5).toFixed(1)}s x=${m.x.toFixed(2)} y=${m.y.toFixed(2)} v=${Math.hypot(m.vx, m.vy, m.vz).toFixed(2)}`);
    finished = (await page.evaluate(() => window.__TEST__.results().length)) >= 1;
    if (s === 4) {
      await page.evaluate(() => window.__TEST__.lookAt(2, 1.2, 0, 4));
      await page.screenshot({ path: 'test-results/stage4-seesaw.png' });
    }
  }
  console.log(trail.join('\n'));
  expect(finished).toBe(true);
});
