import * as THREE from 'three';
import { boxGeo, mergeGeometries } from '../geometry/sweep';
import { H, v3, type BuiltPiece, type Mechanism, type MechanismContext, type PieceDef } from './types';

/** C major scale, C5..A5: one bar each, descending like a staircase. */
const NOTES = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0];
const KEY_COLORS = [0xe0574f, 0xf2b544, 0x3ec46d, 0x3aa0ff, 0xc36bff, 0xff8a3a];
/** Bar centres along the piece (2 cells long, entry at x = -0.5, exit at x = 1.5). */
const BAR_X = NOTES.map((_, i) => -0.25 + i * 0.3);
/** Bar top heights: from just below the entry deck (H) down to just above the exit deck (0). */
const BAR_TOP = NOTES.map((_, i) => 0.42 - i * 0.08);
/** Bar lengths across the track: longer = lower note, like a real xylophone. */
const BAR_LEN = NOTES.map((_, i) => 1.15 - i * 0.09);
/** Wide bars with only 0.1 m gaps: a slow marble cannot sink or wedge between neighbours. */
const BAR_W = 0.2;
const BAR_T = 0.035;

/** Hook for the audio engine; set by the game so pieces stay decoupled from it. */
export const xylophoneHooks: { play: (freq: number) => void } = { play: () => undefined };

/**
 * Xylophone: six separate coloured bars laid across the track as a descending
 * staircase. The marble hops from bar to bar, and each landing rings that bar's
 * note. Thin side rails keep the marble on the bars; the bar ends stick out
 * past them, shorter for the higher notes.
 */
export const xylophoneDef: PieceDef = {
  id: 'xylophone',
  name: '木琴道',
  footprint: [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
  ],
  heightUnits: 2,
  ports: [
    { pos: v3(-0.5, H, 0), dir: v3(-1, 0, 0), kind: 'in' },
    { pos: v3(1.5, 0, 0), dir: v3(1, 0, 0), kind: 'out' },
  ],
  build(): BuiltPiece {
    // Flat bars: a tilted bar lets a marble lean back against the previous bar's edge and cradle there.
    const bars = NOTES.map((_, i) => ({
      geometry: boxGeo(v3(BAR_X[i], BAR_TOP[i] - BAR_T / 2, 0), v3(BAR_W / 2, BAR_T / 2, BAR_LEN[i] / 2)),
      color: KEY_COLORS[i],
    }));

    // Side rails: thin walls following the staircase slope, inner faces at z = +-0.3.
    const slope = (BAR_TOP[0] - BAR_TOP[NOTES.length - 1]) / (BAR_X[NOTES.length - 1] - BAR_X[0]);
    const tilt = Math.atan(slope);
    const railLen = 2.0 / Math.cos(tilt);
    const midX = 0.5;
    const midTop = BAR_TOP[0] - slope * (midX - BAR_X[0]);
    const rail = (z: number) => {
      const g = new THREE.BoxGeometry(railLen, 0.2, 0.04);
      g.rotateZ(-tilt);
      g.translate(midX, midTop + 0.1, z);
      return g;
    };
    const rails = mergeGeometries([rail(0.32), rail(-0.32)]);

    // Resonator box under the bars and two legs (visual only).
    const base = new THREE.BoxGeometry(railLen, 0.08, 0.7);
    base.rotateZ(-tilt);
    base.translate(midX, midTop - 0.13, 0);
    const legTop0 = BAR_TOP[0] - 0.17;
    const legTop1 = BAR_TOP[NOTES.length - 1] - 0.17 + 0.3;
    const legs = mergeGeometries([
      boxGeo(v3(-0.3, legTop0 / 2, 0), v3(0.04, Math.max(0.03, legTop0 / 2), 0.3)),
      boxGeo(v3(1.3, legTop1 / 2 - 0.15, 0), v3(0.04, Math.max(0.03, legTop1 / 2), 0.3)),
    ]);

    // Short landing strip after the last bar, sloping down to the exit deck.
    // Short flat landing strip after the last bar, level with the exit deck.
    const strip = boxGeo(v3(1.42, -0.04, 0), v3(0.09, 0.04, 0.36));

    return {
      parts: [
        ...bars.map((b) => ({ geometry: b.geometry, material: 'accent' as const, color: b.color })),
        { geometry: strip, material: 'wood' },
        { geometry: rails, material: 'dark' },
        { geometry: base, material: 'dark', collide: false },
        { geometry: legs, material: 'dark', collide: false },
      ],
      mechanisms: [makeKeys],
    };
  },
};

/** Rings a bar's note when a marble lands on it (crosses the bar's x close to its top). */
function makeKeys(ctx: MechanismContext): Mechanism {
  const inv = ctx.quat.clone().invert();
  const local = new THREE.Vector3();
  const lastX = new Map<number, number>();
  return {
    update(_dt, marbles) {
      for (const m of marbles) {
        local.copy(m.pos).sub(ctx.origin).applyQuaternion(inv);
        const inside = Math.abs(local.z) < 0.4 && local.x > -0.6 && local.x < 1.6 && local.y > -0.2 && local.y < 0.9;
        const prev = lastX.get(m.id);
        if (inside && prev !== undefined) {
          BAR_X.forEach((bx, i) => {
            const crossed = (prev < bx && local.x >= bx) || (prev > bx && local.x <= bx);
            if (crossed && local.y - BAR_TOP[i] > 0.1 && local.y - BAR_TOP[i] < 0.32) xylophoneHooks.play(NOTES[i]);
          });
        }
        if (inside) lastX.set(m.id, local.x);
        else lastX.delete(m.id);
      }
    },
    dispose() {
      lastX.clear();
    },
  };
}
