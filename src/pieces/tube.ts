import * as THREE from 'three';
import { slopePath, linePath, tubeShell, type TubeSection } from '../geometry/sweep';
import { H, v3, type PieceDef } from './types';

/** Bore radius along the middle of the tube. The marble (r = 0.15) can wander 0.15 off axis. */
const R_MID = 0.3;
/** Bore radius at the mouths. Flared just enough that a marble arriving off-centre in a
 *  trough (up to 0.20 off the centre line) flies in instead of hitting the rim. */
const R_END = 0.37;
const WALL = 0.04;
const RING = 24;
/** Fraction of the length each mouth's flare takes. */
const FLARE = 0.15;

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Cross-section of the tube: it flares towards both mouths so a marble arriving off-centre in a
 * trough flies in rather than hitting the rim. The bore's lowest point sits at u = 0, level with
 * the trough floor of a standard track, which is why the centre rides at u = rIn.
 */
function tubeSection(t: number): TubeSection {
  const e = Math.min(1, Math.min(t, 1 - t) / FLARE);
  const rIn = R_END + (R_MID - R_END) * smooth(e);
  return { rIn, rOut: rIn + WALL, centre: rIn };
}

/** Straight tube, one cell, level. Reversible like a plain straight. */
export const tubeDef: PieceDef = {
  id: 'tube',
  name: '管道',
  family: { id: 'tube', label: '直管' },
  footprint: [{ x: 0, z: 0 }],
  heightUnits: 2,
  ports: [
    { pos: v3(-0.5, 0, 0), dir: v3(-1, 0, 0), kind: 'both' },
    { pos: v3(0.5, 0, 0), dir: v3(1, 0, 0), kind: 'both' },
  ],
  build() {
    return {
      parts: [
        { geometry: tubeShell(linePath(v3(-0.5, 0, 0), v3(0.5, 0, 0)), 20, tubeSection, RING), material: 'glass' },
      ],
    };
  },
};

/** Sloped tube: two cells, drops one level, same bore. */
export const tubeSlopeDef: PieceDef = {
  id: 'tube_slope',
  name: '管道斜坡',
  family: { id: 'tube', label: '斜管' },
  footprint: [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
  ],
  heightUnits: 3,
  ports: [
    { pos: v3(-0.5, H, 0), dir: v3(-1, 0, 0), kind: 'in' },
    { pos: v3(1.5, 0, 0), dir: v3(1, 0, 0), kind: 'out' },
  ],
  build() {
    return {
      parts: [
        { geometry: tubeShell(slopePath(v3(-0.5, H, 0), v3(1.5, 0, 0)), 32, tubeSection, RING), material: 'glass' },
      ],
    };
  },
};
