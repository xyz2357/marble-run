import * as THREE from 'three';
import { slopePath, sweep } from '../geometry/sweep';
import { H, v3, type PieceDef } from './types';

/**
 * Funnel over a 3x3 block (anchor = center cell). Marbles can enter from any
 * of the four edge midpoints at level 0 (they roll off the track onto the rim),
 * spiral down the bowl, drop through the center tube onto a chute and exit at
 * the +X edge, 3 levels below.
 */
export const funnelDef: PieceDef = {
  id: 'funnel',
  name: '漏斗',
  footprint: [-1, 0, 1].flatMap((x) => [-1, 0, 1].map((z) => ({ x, z }))),
  heightUnits: 1,
  ports: [
    { pos: v3(-1.5, 0, 0), dir: v3(-1, 0, 0), kind: 'in' },
    { pos: v3(0, 0, -1.5), dir: v3(0, 0, -1), kind: 'in' },
    { pos: v3(0, 0, 1.5), dir: v3(0, 0, 1), kind: 'in' },
    { pos: v3(1.5, 0, 0), dir: v3(1, 0, 0), kind: 'in' },
    { pos: v3(1.5, -3 * H, 0), dir: v3(1, 0, 0), kind: 'out' },
  ],
  build() {
    const chuteY = -3 * H; // -1.5
    const rimR = 1.5;
    const holeR = 0.35;
    const bowlDepth = 0.6;
    const chuteTopY = chuteY + 0.3; // landing zone under the tube, slopes down to the exit
    const tubeBottom = chuteTopY + 0.25; // just above the chute rails (rail top = chuteTopY + 0.2)

    // Closed lathe profile (r, y), revolved around Y. Inner surface first, then outer shell.
    const pts: THREE.Vector2[] = [];
    pts.push(new THREE.Vector2(holeR, tubeBottom)); // tube bottom, inner
    pts.push(new THREE.Vector2(holeR, -bowlDepth)); // hole
    // bowl inner: steep near the hole, easing out towards the rim (t=0 hole, t=1 rim)
    const steps = 10;
    const bowlY = (t: number) => -bowlDepth * Math.pow(1 - t, 1.7);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const r = holeR + (rimR - 0.05 - holeR) * t;
      pts.push(new THREE.Vector2(r, bowlY(t)));
    }
    pts.push(new THREE.Vector2(rimR, 0.0)); // rim edge
    pts.push(new THREE.Vector2(rimR, -0.08)); // outer rim underside
    // outer shell back to tube
    for (let i = steps - 1; i >= 1; i--) {
      const t = i / steps;
      const r = holeR + 0.08 + (rimR - 0.05 - holeR) * t;
      pts.push(new THREE.Vector2(r, bowlY(t) - 0.08));
    }
    pts.push(new THREE.Vector2(holeR + 0.08, -bowlDepth - 0.08));
    pts.push(new THREE.Vector2(holeR + 0.08, tubeBottom));
    pts.push(new THREE.Vector2(holeR, tubeBottom));
    const bowl = new THREE.LatheGeometry(pts, 48);
    bowl.computeVertexNormals();

    // Exit chute: starts behind the tube (start cap = back wall) and slopes down to the +X edge,
    // so marbles that drop in vertically start rolling towards the exit.
    const chute = sweep(slopePath(v3(-0.6, chuteTopY, 0), v3(1.5, chuteY, 0)), 20);

    // Four little legs so it doesn't float visually (no collider).
    const legGeos: THREE.BufferGeometry[] = [];
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const g = new THREE.BoxGeometry(0.1, -chuteY + 0.05, 0.1);
      g.translate(sx * 1.2, chuteY / 2 - 0.02, sz * 1.2);
      legGeos.push(g);
    }

    return {
      parts: [
        { geometry: bowl, material: 'wood' },
        { geometry: chute, material: 'wood' },
        ...legGeos.map((geometry) => ({ geometry, material: 'dark' as const, collide: false })),
      ],
    };
  },
};
