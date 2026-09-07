import { test, expect, type Page } from '@playwright/test';

type Placed = { def: string; cell: { x: number; z: number }; level: number; rot: number };
type Candidate = { placed: Placed; valid: boolean; snapped: boolean; alternatives: number } | null;
type Seam = {
  ready: boolean;
  pause: () => void;
  stepN: (n: number) => void;
  marbles: () => { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }[];
  pieces: () => Placed[];
  ports: () => { piece: string; x: number; y: number; z: number; dx: number; dz: number; kind: string }[];
  openPortsScreen: () => { piece: string; kind: string; x: number; y: number; wx: number; wy: number; wz: number }[];
  pieceScreenPos: (i: number) => { x: number; y: number; behind: boolean } | null;
  setMode: (m: 'edit' | 'play') => void;
  mode: () => 'edit' | 'play';
  setToolMode: (m: 'chain' | 'free') => void;
  select: (id: string | null) => void;
  setLevel: (n: number) => void;
  rotate: () => void;
  place: () => number | null;
  undo: () => boolean;
  redo: () => boolean;
  clearTrack: () => void;
  candidate: () => Candidate;
  editorState: () => { mode: string; selected: string | null; level: number; rot: number; canUndo: boolean; canRedo: boolean };
  exportJSON: () => string;
  importJSON: (t: string) => void;
  frameTrack: () => void;
  lookAt: (x: number, y: number, z: number, dist: number) => void;
};
declare global {
  interface Window {
    __TEST__: Seam;
  }
}

async function openEmptyEditor(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(() => {
    window.__TEST__.clearTrack();
    window.__TEST__.setToolMode('free');
    window.__TEST__.lookAt(0, 2, 0, 10);
  });
  return errors;
}

test('palette + toolbar render, demo track loads in edit mode', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__TEST__.mode())).toBe('edit');
  expect(await page.evaluate(() => window.__TEST__.pieces().length)).toBe(15);
  await expect(page.locator('#palette .piece')).toHaveCount(23);
  await expect(page.locator('#toolbar [data-action="mode-edit"]')).toHaveClass(/active/);
  await page.screenshot({ path: 'test-results/stage2-ui.png' });
});

test('place with the mouse: free placement, then snap to the open port', async ({ page }) => {
  const errors = await openEmptyEditor(page);
  expect(await page.evaluate(() => window.__TEST__.pieces().length)).toBe(0);

  // Select the start piece from the palette and place it at the screen center (free placement at level 4).
  await page.click('#palette .piece[data-id="start"]');
  await page.evaluate(() => window.__TEST__.setLevel(4));
  await page.mouse.move(640, 420);
  const c1 = await page.evaluate(() => window.__TEST__.candidate());
  expect(c1).not.toBeNull();
  expect(c1!.snapped).toBe(false);
  expect(c1!.valid).toBe(true);
  expect(c1!.placed.level).toBe(4);
  await page.screenshot({ path: 'test-results/stage2-ghost.png' });
  await page.mouse.click(640, 420);
  let pieces = await page.evaluate(() => window.__TEST__.pieces());
  expect(pieces).toHaveLength(1);
  expect(pieces[0].def).toBe('start');

  // Select a slope and hover near the start's exit port: candidate must snap.
  await page.click('#palette .piece[data-id="slope"]');
  const ports = await page.evaluate(() => window.__TEST__.openPortsScreen());
  const exit = ports.find((p) => p.piece === 'start' && p.kind === 'out')!;
  expect(exit).toBeDefined();
  await page.mouse.move(exit.x + 10, exit.y + 6);
  const c2 = await page.evaluate(() => window.__TEST__.candidate());
  expect(c2).not.toBeNull();
  expect(c2!.snapped).toBe(true);
  expect(c2!.valid).toBe(true);
  await page.mouse.click(exit.x + 10, exit.y + 6);
  pieces = await page.evaluate(() => window.__TEST__.pieces());
  expect(pieces).toHaveLength(2);

  // The slope's entry must coincide with the start's exit.
  const all = await page.evaluate(() => window.__TEST__.ports());
  const startOut = all.find((p) => p.piece === 'start')!;
  const slopeIn = all.find((p) => p.piece === 'slope' && p.kind === 'in')!;
  expect(Math.hypot(startOut.x - slopeIn.x, startOut.y - slopeIn.y, startOut.z - slopeIn.z)).toBeLessThan(1e-4);
  expect(slopeIn.dx).toBeCloseTo(-startOut.dx, 6);

  // Overlap is rejected: hovering the start piece location with a straight is invalid.
  await page.click('#palette .piece[data-id="straight"]');
  const startPos = (await page.evaluate(() => window.__TEST__.pieceScreenPos(0)))!;
  await page.mouse.move(startPos.x, startPos.y);
  const c3 = await page.evaluate(() => window.__TEST__.candidate());
  // Either it snapped to some other open port (valid) or it's a free placement on the start cell (invalid).
  if (c3 && !c3.snapped) expect(c3.valid).toBe(false);

  expect(errors).toEqual([]);
});

test('snap alternatives, undo/redo, delete, autosave survives reload', async ({ page }) => {
  await openEmptyEditor(page);
  // Build via the seam: start + straight snapped to its exit.
  await page.evaluate(() => {
    window.__TEST__.select('start');
    window.__TEST__.setLevel(6);
  });
  await page.mouse.move(640, 400);
  await page.mouse.click(640, 400);
  await page.evaluate(() => window.__TEST__.select('curve_r'));
  let exit = (await page.evaluate(() => window.__TEST__.openPortsScreen())).find((p) => p.piece === 'start')!;
  await page.mouse.move(exit.x, exit.y);
  const c = await page.evaluate(() => window.__TEST__.candidate());
  expect(c?.snapped).toBe(true);
  // A curve has two 'both' ports => two ways to attach (right turn or mirrored). R cycles.
  expect(c!.alternatives).toBe(2);
  const first = c!.placed;
  await page.keyboard.press('r');
  const c2 = await page.evaluate(() => window.__TEST__.candidate());
  expect(c2!.placed.rot === first.rot && c2!.placed.cell.x === first.cell.x && c2!.placed.cell.z === first.cell.z).toBe(false);
  await page.mouse.click(exit.x, exit.y);
  expect(await page.evaluate(() => window.__TEST__.pieces().length)).toBe(2);

  // Undo / redo.
  expect(await page.evaluate(() => window.__TEST__.editorState().canUndo)).toBe(true);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__TEST__.pieces().length)).toBe(1);
  await page.keyboard.press('Control+y');
  expect(await page.evaluate(() => window.__TEST__.pieces().length)).toBe(2);

  // Delete the curve with a right click on it (no tool selected).
  await page.evaluate(() => window.__TEST__.select(null));
  const pos = (await page.evaluate(() => window.__TEST__.pieceScreenPos(1)))!;
  await page.mouse.move(pos.x, pos.y);
  await page.mouse.click(pos.x, pos.y, { button: 'right' });
  expect(await page.evaluate(() => window.__TEST__.pieces().length)).toBe(1);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__TEST__.pieces().length)).toBe(2);

  // Autosave: reload and the two pieces are still there (in edit mode).
  const before = await page.evaluate(() => window.__TEST__.pieces());
  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true, null, { timeout: 30_000 });
  const after = await page.evaluate(() => window.__TEST__.pieces());
  expect(after).toEqual(before);
  expect(await page.evaluate(() => window.__TEST__.mode())).toBe('edit');
});

test('export/import round trip and play mode runs the marble', async ({ page }) => {
  await openEmptyEditor(page);
  await page.evaluate(() => {
    window.__TEST__.select('start');
    window.__TEST__.setLevel(5);
  });
  await page.mouse.move(640, 400);
  await page.mouse.click(640, 400);
  for (const id of ['slope', 'straight', 'end']) {
    await page.evaluate((d) => window.__TEST__.select(d), id);
    const exits = await page.evaluate(() => window.__TEST__.openPortsScreen());
    const exit = exits.find((p) => p.kind !== 'in')!;
    await page.mouse.move(exit.x, exit.y);
    const cand = await page.evaluate(() => window.__TEST__.candidate());
    expect(cand?.snapped, `snap ${id}`).toBe(true);
    await page.mouse.click(exit.x, exit.y);
  }
  expect(await page.evaluate(() => window.__TEST__.pieces().length)).toBe(4);

  const json = await page.evaluate(() => window.__TEST__.exportJSON());
  const parsed = JSON.parse(json);
  expect(parsed.version).toBe(1);
  expect(parsed.pieces).toHaveLength(4);
  await page.evaluate(() => window.__TEST__.clearTrack());
  expect(await page.evaluate(() => window.__TEST__.pieces().length)).toBe(0);
  await page.evaluate((t) => window.__TEST__.importJSON(t), json);
  expect(await page.evaluate(() => window.__TEST__.pieces())).toEqual(parsed.pieces);

  // Play: switching mode spawns a marble at the start; it rolls down the slope into the end box.
  await page.click('#toolbar [data-action="mode-play"]');
  await page.evaluate(() => window.__TEST__.pause());
  expect(await page.evaluate(() => window.__TEST__.marbles().length)).toBe(1);
  let finished = 0;
  for (let i = 0; i < 15 && finished === 0; i++) {
    await page.evaluate(() => window.__TEST__.stepN(120));
    finished = (await page.evaluate(() => (window as unknown as { __TEST__: { finished: () => number[] } }).__TEST__.finished())).length;
  }
  expect(finished).toBe(1);
  await page.evaluate(() => window.__TEST__.frameTrack());
  await page.screenshot({ path: 'test-results/stage2-play.png' });
});
