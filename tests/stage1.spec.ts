import { test, expect, type Page } from '@playwright/test';

type MarbleState = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };
type Seam = {
  ready: boolean;
  pause: () => void;
  stepN: (n: number) => void;
  spawnMarble: (x: number, y: number, z: number) => number;
  spawnAtStart: () => number[];
  clearMarbles: () => void;
  marbles: () => MarbleState[];
  finished: () => number[];
  pieces: () => { def: string; cell: { x: number; z: number }; level: number; rot: number }[];
  ports: () => { piece: string; x: number; y: number; z: number; dx: number; dz: number; kind: string }[];
  setDebug: (on: boolean) => void;
  frameTrack: () => void;
  lookAt: (x: number, y: number, z: number, dist: number) => void;
};
declare global {
  interface Window {
    __TEST__: Seam;
  }
}

async function waitReady(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  return errors;
}

test('demo track builds with all pieces and ports pair up', async ({ page }) => {
  const errors = await waitReady(page);
  await page.evaluate(() => window.__TEST__.pause());
  const pieces = await page.evaluate(() => window.__TEST__.pieces());
  expect(errors).toEqual([]);
  expect(pieces.length).toBe(15);
  const defs = pieces.map((p) => p.def);
  for (const d of ['start', 'slope', 'straight', 'curve_r', 'curve_l', 'helix', 'bigcurve_r', 'slope_steep', 'funnel', 'end']) {
    expect(defs).toContain(d);
  }

  // Every 'out' port of a piece must coincide with an 'in'/'both' port of another piece (opposite direction),
  // except the funnel's unused entries and the end piece.
  const ports = await page.evaluate(() => window.__TEST__.ports());
  const outs = ports.filter((p) => p.kind === 'out' || (p.kind === 'both'));
  let paired = 0;
  for (const o of outs) {
    const match = ports.find(
      (q) => q !== o && Math.hypot(q.x - o.x, q.y - o.y, q.z - o.z) < 1e-4 && Math.abs(q.dx + o.dx) < 1e-6 && Math.abs(q.dz + o.dz) < 1e-6,
    );
    if (match) paired++;
  }
  // 14 joints, each joint counted from both sides for 'both' ports; at least 14 out-side matches.
  expect(paired).toBeGreaterThanOrEqual(14);

  await page.screenshot({ path: 'test-results/stage1-track.png' });
});

test('marble runs the whole demo track and reaches the goal', async ({ page }) => {
  await waitReady(page);
  await page.evaluate(() => window.__TEST__.pause());
  const start = await page.evaluate(() => window.__TEST__.marbles());
  expect(start).toHaveLength(1);

  const trail: MarbleState[] = [];
  let finished: number[] = [];
  const shots = [2, 5, 8, 12, 15, 17];
  for (let sec = 1; sec <= 40; sec++) {
    await page.evaluate(() => window.__TEST__.stepN(120));
    const ms = await page.evaluate(() => window.__TEST__.marbles());
    finished = await page.evaluate(() => window.__TEST__.finished());
    if (ms[0]) trail.push(ms[0]);
    if (shots.includes(sec)) {
      const m = ms[0];
      if (m) await page.evaluate(([x, y, z]) => window.__TEST__.lookAt(x, y, z, 5), [m.x, m.y, m.z] as const);
      await page.screenshot({ path: `test-results/stage1-t${sec}.png` });
    }
    if (finished.length > 0) break;
  }
  // Print the trail so a failure is diagnosable from the log.
  console.log(trail.map((m, i) => `${i + 1}s (${m.x.toFixed(2)}, ${m.y.toFixed(2)}, ${m.z.toFixed(2)}) v=${Math.hypot(m.vx, m.vy, m.vz).toFixed(2)}`).join('\n'));
  expect(finished).toHaveLength(1);
  // Marble never fell off the table (y stayed above the ground by at least a bit until the end box)
  for (const m of trail) expect(m.y).toBeGreaterThan(-0.5);
  await page.evaluate(() => window.__TEST__.frameTrack());
  await page.screenshot({ path: 'test-results/stage1-finished.png' });
});

test('funnel: marble stays on the bowl surface and drops through the hole without bouncing', async ({ page }) => {
  await waitReady(page);
  await page.evaluate(() => window.__TEST__.pause());
  const funnel = (await page.evaluate(() => window.__TEST__.pieces())).find((p) => p.def === 'funnel')!;
  const cx = funnel.cell.x;
  const cz = funnel.cell.z;
  const cy = funnel.level * 0.5;

  // Run until the marble enters the funnel footprint at rim level, then sample every 4 steps.
  let inFunnel = false;
  let maxUpwardVy = 0;
  let minHeightOverSurface = Infinity;
  let dropped = false;
  for (let step = 0; step < 120 * 30 && !dropped; step += 4) {
    await page.evaluate(() => window.__TEST__.stepN(4));
    const m = (await page.evaluate(() => window.__TEST__.marbles()))[0];
    const r = Math.hypot(m.x - cx, m.z - cz);
    const y = m.y - cy;
    if (!inFunnel && r < 1.5 && Math.abs(y) < 0.3) inFunnel = true;
    if (!inFunnel) continue;
    if (y < -0.5) {
      dropped = true; // fell through the hole into the tube
      break;
    }
    // Same profile as src/pieces/funnel.ts: rim fillet (R=1.4) into a 31deg cone.
    const filletR = 1.4;
    const slope = 0.6;
    const phiMax = Math.atan(slope);
    const coneStart = 1.5 - filletR * Math.sin(phiMax);
    const filletDrop = filletR * (1 - Math.cos(phiMax));
    const rr = Math.max(r, 0.4);
    const surface = rr >= coneStart ? -filletR * (1 - Math.sqrt(1 - ((1.5 - rr) / filletR) ** 2)) : -filletDrop - slope * (coneStart - rr);
    if (r > 0.55) minHeightOverSurface = Math.min(minHeightOverSurface, y - surface);
    if (r < 1.3) maxUpwardVy = Math.max(maxUpwardVy, m.vy);
  }
  expect(inFunnel).toBe(true);
  expect(dropped).toBe(true);
  // Marble center must stay above the visual surface (radius 0.15 minus some slack for the faceted mesh).
  expect(minHeightOverSurface).toBeGreaterThan(0.08);
  // No bounce inside the bowl.
  expect(maxUpwardVy).toBeLessThan(0.3);
});
