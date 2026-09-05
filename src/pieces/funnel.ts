import * as THREE from 'three';
import { slopePath, sweep } from '../geometry/sweep';
import { H, v3, type PieceDef } from './types';

/**
 * Funnel over a 3x3 block (anchor = center cell). The marble enters radially
 * from the -X edge at level 0. The rim is a large-radius convex fillet
 * (curvature radius 1.4 m, so marbles up to ~3.7 m/s stay in contact instead
 * of hopping), blending into a 31-degree cone that leads to a wide center hole.
 * A conical tube below the hole gathers the marble onto a sloped chute that
 * exits at the +X edge, 3 levels down.
 */
export const funnelDef: PieceDef = {
  id: 'funnel',
  name: '漏斗',
  footprint: [-1, 0, 1].flatMap((x) => [-1, 0, 1].map((z) => ({ x, z }))),
  heightUnits: 1,
  ports: [
    { pos: v3(-1.5, 0, 0), dir: v3(-1, 0, 0), kind: 'in' },
    { pos: v3(1.5, -3 * H, 0), dir: v3(1, 0, 0), kind: 'out' },
  ],
  build() {
    const chuteY = -3 * H; // -1.5
    const rimR = 1.5;
    const holeR = 0.4; // wide enough that a fast marble drops in before reaching the far edge
    const tubeR = 0.3; // tube narrows to this so marbles land centered on the chute
    const coneSlope = 0.6; // ~31 deg
    const filletR = 1.4; // convex rim fillet radius of curvature
    const phiMax = Math.atan(coneSlope);
    const filletExtent = filletR * Math.sin(phiMax); // radial extent of the fillet
    const filletDrop = filletR * (1 - Math.cos(phiMax));
    const coneStartR = rimR - filletExtent;
    const chuteTopY = chuteY + 0.3; // landing zone under the tube, slopes down to the exit
    const tubeBottom = chuteTopY + 0.25; // just above the chute rails (rail top = chuteTopY + 0.2)

    /** Bowl surface height at radius r: 0 at the rim, convex fillet, then cone down to the hole. */
    const bowlY = (r: number): number => {
      r = THREE.MathUtils.clamp(r, holeR, rimR);
      if (r >= coneStartR) {
        const sinPhi = (rimR - r) / filletR;
        return -filletR * (1 - Math.sqrt(1 - sinPhi * sinPhi));
      }
      return -filletDrop - coneSlope * (coneStartR - r);
    };

    // Closed lathe profile (r, y), revolved around Y. Inner surface first, then outer shell.
    const inner: THREE.Vector2[] = [];
    inner.push(new THREE.Vector2(tubeR, tubeBottom)); // tube bottom, inner (narrow)
    inner.push(new THREE.Vector2(holeR, bowlY(holeR))); // hole edge (wide): conical tube
    inner.push(new THREE.Vector2(coneStartR, bowlY(coneStartR)));
    const filletSteps = 10;
    for (let i = 1; i <= filletSteps; i++) {
      const r = coneStartR + (rimR - coneStartR) * (i / filletSteps);
      inner.push(new THREE.Vector2(r, bowlY(r)));
    }
    const pts: THREE.Vector2[] = [...inner];
    pts.push(new THREE.Vector2(rimR, -0.08)); // outer rim underside
    // outer shell: inner surface offset downwards, walked back towards the tube
    for (let i = inner.length - 2; i >= 1; i--) {
      const p = inner[i];
      pts.push(new THREE.Vector2(Math.max(p.x - 0.02, holeR + 0.06), p.y - 0.08));
    }
    pts.push(new THREE.Vector2(tubeR + 0.08, tubeBottom));
    pts.push(new THREE.Vector2(tubeR, tubeBottom));
    // LatheGeometry gives outward (+r) normals for a profile that runs upwards. Our loop runs
    // up the inner surface, so reverse it: inner-surface normals then point up into the bowl and
    // the shell normals point down/out. Rapier's trimesh (with FIX_INTERNAL_EDGES) is orientation
    // sensitive, so wrong winding lets the marble fall through onto the shell inside the solid.
    pts.reverse();
    const bowl = new THREE.LatheGeometry(pts, 64);
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
