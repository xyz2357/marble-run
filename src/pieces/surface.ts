import { boxGeo, mergeGeometries, slopePath, sweep, TROUGH_HALF } from '../geometry/sweep';
import { H, v3, type BuiltPiece, type PieceDef } from './types';

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Deck height of the standard 2-cell slope (entry at x = -0.5 and y = H, exit at x = 1.5 and y = 0). */
function deckY(x: number): number {
  return H * (1 - smooth((x + 0.5) / 2));
}

/**
 * Ice run: a 2-cell slope like `slope`, but frictionless. The marble slides instead of
 * rolling, so all of the drop goes into forward speed and it leaves the piece about 10%
 * faster than off a wooden slope (measured 3.2 vs 2.9 m/s from the same approach).
 *
 * That speed only survives if the marble does not have to start rolling again: spinning up
 * on the next wooden piece costs more than the ice gained (the classic 5/7 slip-up loss, so
 * ice feeding a normal track ends up SLOWER overall). Use it just before a jump pad, a drop
 * or the goal, where the marble never touches a rolling surface again.
 */
export const iceDef: PieceDef = {
  id: 'ice',
  name: '冰道',
  family: { id: 'surface', label: '冰面' },
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
    return {
      parts: [
        {
          geometry: sweep(slopePath(v3(-0.5, H, 0), v3(1.5, 0, 0)), 24),
          material: 'accent',
          color: 0x9fd8ef,
          friction: 0,
          restitution: 0.05,
        },
      ],
    };
  },
};

/** Ridge crests along the brake deck. */
const RIDGE_X = [-0.15, 0.15, 0.45, 0.75, 1.05];
/** How far a ridge stands above the trough floor. Tall enough to cost speed, low
 *  enough that the marble (r = 0.15) rides over it instead of being launched. */
const RIDGE_RISE = 0.035;
const RIDGE_HALF_X = 0.045;

/**
 * Brake run: the same 2-cell slope with a washboard of five low transverse ridges.
 * The marble drops onto each crest and the near-inelastic impacts eat its speed, so
 * it leaves much slower than off a plain slope. The braking is geometric, not
 * frictional: Coulomb friction alone barely slows a rolling ball.
 */
export const brakeDef: PieceDef = {
  id: 'brake',
  name: '减速带',
  family: { id: 'surface', label: '减速' },
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
    const deck = sweep(slopePath(v3(-0.5, H, 0), v3(1.5, 0, 0)), 24);
    // Each ridge is a separate collider box sunk into the deck, so no two decks share
    // a collider (which would produce ghost edges along their boundary).
    const ridges = mergeGeometries(
      RIDGE_X.map((x) => boxGeo(v3(x, deckY(x) + RIDGE_RISE / 2 - 0.02, 0), v3(RIDGE_HALF_X, RIDGE_RISE / 2 + 0.02, TROUGH_HALF))),
    );
    return {
      parts: [
        { geometry: deck, material: 'wood' },
        { geometry: ridges, material: 'accent', color: 0xd0703a, restitution: 0 },
      ],
    };
  },
};
