import { helixPath, linePath, mergeGeometries, sweep } from '../geometry/sweep';
import { H, v3, type PieceDef } from './types';

/**
 * Helix over a 3x3 block (anchor = center cell). Enters at the -X edge of the
 * (-1,-1) cell heading +X, circles the block center once per turn and exits at
 * the +X edge of the (1,-1) cell, `turns*2` levels lower.
 */
export function helixDef(turns = 1): PieceDef {
  const dropUnits = 2 * turns;
  const drop = dropUnits * H;
  const R = 1;
  const z = -1;
  return {
    id: turns === 1 ? 'helix' : `helix${turns}`,
    name: turns === 1 ? '螺旋' : `螺旋x${turns}`,
    footprint: [-1, 0, 1].flatMap((x) => [-1, 0, 1].map((zz) => ({ x, z: zz }))),
    heightUnits: dropUnits + 1,
    ports: [
      { pos: v3(-1.5, drop, z), dir: v3(-1, 0, 0), kind: 'in' },
      { pos: v3(1.5, 0, z), dir: v3(1, 0, 0), kind: 'out' },
    ],
    build() {
      const top = drop;
      const leadIn = sweep(linePath(v3(-1.5, top, z), v3(0, top, z)), 2, undefined, true);
      // helix center at (0, top, 0): at theta=0 the point is (0, top, -R) = (0, top, z) heading +X
      const spiral = sweep(helixPath(v3(0, top, 0), R, turns, drop, 1), 48 * turns);
      const leadOut = sweep(linePath(v3(0, 0, z), v3(1.5, 0, z)), 2);
      return { parts: [{ geometry: mergeGeometries([leadIn, spiral, leadOut]), material: 'wood' }] };
    },
  };
}
