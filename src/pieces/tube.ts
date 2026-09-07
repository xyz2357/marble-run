import * as THREE from 'three';
import { slopePath, linePath, sweep, type Profile } from '../geometry/sweep';
import { H, v3, type PieceDef } from './types';

/** Bore radius along the middle of the tube. The marble (r = 0.15) can wander 0.15 off axis. */
const R_MID = 0.3;
/** Bore radius at the mouths. Flared just enough that a marble arriving off-centre in a
 *  trough (up to 0.20 off the centre line) flies in instead of hitting the rim. */
const R_END = 0.37;
const WALL = 0.04;
/**
 * Half-angle of the seam along the top. The section has to stay ONE closed polygon for `sweep`
 * (outer ring out, inner ring back), so the annulus cannot fully close - but 2.5 degrees is a
 * 15 mm hairline, and the tube reads as shut. You see the marble through the glass, not a slot.
 */
const SLIT = THREE.MathUtils.degToRad(2.5);
const RING = 24;
/** Fraction of the length each mouth's flare takes. */
const FLARE = 0.15;

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Cross-section of the tube: an annulus split by a slit at the top, traced as one closed
 * polygon (outer ring CCW, then back along the inner ring CW) so `sweep` gives the outside
 * outward normals and the bore inward-facing ones. Constant vertex count, so the bore can
 * flare towards the mouths. The bore's lowest point sits at u = 0, level with the trough
 * floor of a standard track, which is why the centre is at u = rIn.
 */
function tubeProfile(t: number): Profile {
  const e = Math.min(1, Math.min(t, 1 - t) / FLARE);
  const rIn = R_END + (R_MID - R_END) * smooth(e);
  const rOut = rIn + WALL;
  const a0 = Math.PI / 2 + SLIT;
  const span = Math.PI * 2 - 2 * SLIT;
  const pts: Profile = [];
  for (let i = 0; i <= RING; i++) {
    const th = a0 + (span * i) / RING;
    pts.push([rOut * Math.cos(th), rIn + rOut * Math.sin(th)]);
  }
  for (let i = RING; i >= 0; i--) {
    const th = a0 + (span * i) / RING;
    pts.push([rIn * Math.cos(th), rIn + rIn * Math.sin(th)]);
  }
  return pts;
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
        { geometry: sweep(linePath(v3(-0.5, 0, 0), v3(0.5, 0, 0)), 20, tubeProfile), material: 'glass' },
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
        { geometry: sweep(slopePath(v3(-0.5, H, 0), v3(1.5, 0, 0)), 32, tubeProfile), material: 'glass' },
      ],
    };
  },
};
