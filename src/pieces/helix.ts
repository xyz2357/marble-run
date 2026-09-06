import * as THREE from 'three';
import { sweep, type PathFn } from '../geometry/sweep';
import { H, v3, type PieceDef } from './types';

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Helix over a 3x3 block (anchor = center cell). Enters at the -X edge of the
 * (-1,-1) cell heading +X, circles the block center once per turn and exits at
 * the +X edge of the (1,-1) cell, `turns*2` levels lower. The lead-in, spiral
 * and lead-out form ONE continuously descending path (no flat stretches where a
 * slow or wobbly marble could stall).
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
      // Horizontal layout by arc length: lead-in (1.5) + spiral (2*pi*R*turns) + lead-out (1.5).
      const lIn = 1.5;
      const lSpiral = 2 * Math.PI * R * turns;
      const lOut = 1.5;
      const total = lIn + lSpiral + lOut;
      const horizontal = (s: number): THREE.Vector3 => {
        if (s <= lIn) return v3(-1.5 + s, 0, z);
        if (s <= lIn + lSpiral) {
          const th = (s - lIn) / R; // helix centre at (0, ., 0); th=0 at (0, ., -R) heading +X
          return v3(R * Math.sin(th), 0, -R * Math.cos(th));
        }
        return v3(s - lIn - lSpiral, 0, z);
      };
      // Height descends from `drop` at the entry to 0 at the exit over the whole length: mostly
      // linear (so the exit still has a few degrees of slope and nothing stalls there) with a
      // little easing at both ends.
      const pos = (t: number): THREE.Vector3 => {
        const p = horizontal(t * total);
        p.y = drop * (1 - (0.7 * t + 0.3 * smooth(t)));
        return p;
      };
      const path: PathFn = (t) => {
        const h = 1e-4;
        const a = pos(Math.max(0, t - h));
        const b = pos(Math.min(1, t + h));
        return { pos: pos(t), tan: b.sub(a).normalize() };
      };
      const segments = Math.round(total * 8) + 48 * turns;
      return { parts: [{ geometry: sweep(path, segments), material: 'wood' }] };
    },
  };
}
