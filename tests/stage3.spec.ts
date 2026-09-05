import { test, expect, type Page } from '@playwright/test';

type M = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };
type Seam = {
  ready: boolean;
  pause: () => void;
  resume: () => void;
  stepN: (n: number) => void;
  marbles: () => M[];
  finished: () => number[];
  results: () => { id: number; color: number; time: number }[];
  simTime: () => number;
  spawnBurst: (n: number) => void;
  setAutoSpawn: (on: boolean) => void;
  setTimeScale: (s: number) => void;
  timeScale: () => number;
  setFollow: (on: boolean) => void;
  follow: () => boolean;
  leader: () => { id: number; x: number; y: number; z: number } | null;
  cameraTarget: () => { x: number; y: number; z: number };
  audioStats: () => { available: boolean; state: string; muted: boolean; impacts: number; detected: number };
  wait: (ms: number) => Promise<void>;
  audioPreview: () => Promise<{ impact: { centroid: number; peak: number }; rolling: { centroid: number; peak: number } }>;
  setMode: (m: 'edit' | 'play') => void;
  loadDemo: () => void;
  lookAt: (x: number, y: number, z: number, dist: number) => void;
};
declare global {
  interface Window {
    __TEST__: Seam;
  }
}

async function openPlay(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(() => {
    window.__TEST__.setMode('play');
    window.__TEST__.pause();
  });
}

test('play bar + race panel show in play mode; burst spawns staggered marbles', async ({ page }) => {
  await openPlay(page);
  await expect(page.locator('#playbar')).toBeVisible();
  await expect(page.locator('#race')).toBeVisible();
  await expect(page.locator('#toolbar [data-action="mode-play"]')).toHaveClass(/active/);

  expect(await page.evaluate(() => window.__TEST__.marbles().length)).toBe(1);
  await page.click('#playbar [data-play="burst"]');
  // Marbles are released 0.35 s apart: after 1 s of sim, only some of the 8 have appeared.
  await page.evaluate(() => window.__TEST__.stepN(120));
  const mid = await page.evaluate(() => window.__TEST__.marbles().length);
  expect(mid).toBeGreaterThan(2);
  expect(mid).toBeLessThan(9);
  await page.evaluate(() => window.__TEST__.stepN(120 * 3));
  expect(await page.evaluate(() => window.__TEST__.marbles().length)).toBe(9);
  // Colours differ between marbles.
  await page.evaluate(() => window.__TEST__.lookAt(-3, 5.5, 0, 6));
  await page.screenshot({ path: 'test-results/stage3-burst.png' });
});

test('race: finishers are ranked with times; reset clears everything', async ({ page }) => {
  await openPlay(page);
  await page.evaluate(() => window.__TEST__.spawnBurst(2));
  for (let s = 0; s < 40; s++) {
    await page.evaluate(() => window.__TEST__.stepN(120));
    if ((await page.evaluate(() => window.__TEST__.results().length)) >= 3) break;
  }
  const results = await page.evaluate(() => window.__TEST__.results());
  expect(results.length).toBe(3);
  for (const r of results) {
    expect(r.time).toBeGreaterThan(5);
    expect(r.time).toBeLessThan(40);
  }
  // Ranking list in the DOM matches.
  await expect(page.locator('#race li')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/stage3-race.png' });

  await page.click('#playbar [data-play="reset"]');
  expect(await page.evaluate(() => window.__TEST__.results().length)).toBe(0);
  expect(await page.evaluate(() => window.__TEST__.simTime())).toBe(0);
  expect(await page.evaluate(() => window.__TEST__.marbles().length)).toBe(1);
});

test('slow motion scales realtime; follow camera tracks the leader', async ({ page }) => {
  await openPlay(page);
  await page.keyboard.press('t');
  expect(await page.evaluate(() => window.__TEST__.timeScale())).toBe(0.25);
  await page.evaluate(() => window.__TEST__.resume());
  await page.evaluate(() => window.__TEST__.wait(800));
  const slowSim = await page.evaluate(() => window.__TEST__.simTime());
  expect(slowSim).toBeGreaterThan(0.02);
  expect(slowSim).toBeLessThan(0.4);
  await page.keyboard.press('t');
  expect(await page.evaluate(() => window.__TEST__.timeScale())).toBe(1);

  // Follow: the orbit target converges on the leading marble while it rolls.
  await page.keyboard.press('c');
  expect(await page.evaluate(() => window.__TEST__.follow())).toBe(true);
  await page.evaluate(() => window.__TEST__.wait(1200));
  const leader = (await page.evaluate(() => window.__TEST__.leader()))!;
  const target = await page.evaluate(() => window.__TEST__.cameraTarget());
  expect(Math.hypot(target.x - leader.x, target.y - leader.y, target.z - leader.z)).toBeLessThan(1.5);
  await page.screenshot({ path: 'test-results/stage3-follow.png' });
});

test('audio engine starts after a gesture and registers impacts during a run', async ({ page }) => {
  await openPlay(page);
  await page.mouse.click(640, 400); // user gesture unlocks the AudioContext
  await page.evaluate(() => window.__TEST__.spawnBurst(3));
  // Let real frames render between chunks so per-frame impact detection runs.
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.__TEST__.stepN(60));
    await page.evaluate(() => window.__TEST__.wait(30));
  }
  const stats = await page.evaluate(() => window.__TEST__.audioStats());
  console.log('audio', JSON.stringify(stats));
  expect(stats.available).toBe(true);
  expect(stats.detected).toBeGreaterThan(0);
  // Clicks are only synthesized while the context is running (headless browsers may keep it suspended).
  if (stats.state === 'running') expect(stats.impacts).toBeGreaterThan(0);
  await page.keyboard.press('m');
  expect((await page.evaluate(() => window.__TEST__.audioStats())).muted).toBe(true);
});

test('audio character: impacts are low wooden tocks, rolling is a low rumble (no chirps)', async ({ page }) => {
  await openPlay(page);
  const stats = await page.evaluate(() => window.__TEST__.audioPreview());
  console.log('audio preview', JSON.stringify(stats));
  expect(stats.impact.peak).toBeGreaterThan(0.05);
  expect(stats.rolling.peak).toBeGreaterThan(0.02);
  // Spectral centroid well below the 1.5-3 kHz "bird" range.
  expect(stats.impact.centroid).toBeLessThan(1100);
  expect(stats.rolling.centroid).toBeLessThan(700);
});
