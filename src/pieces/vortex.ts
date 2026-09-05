import * as THREE from 'three';
import { arcPath, boxGeo, mergeGeometries, slopePath, sweep } from '../geometry/sweep';
import { H, v3, type PieceDef } from './types';

/**
 * Vortex bowl over a 5x5 block (anchor = centre cell). The entry track curves
 * along the outside of the bowl and releases the marble almost tangentially, so
 * it orbits the bowl and spirals into the centre hole. A rounded rim keeps the
 * marble in contact and a lip keeps fast marbles in. The hole feeds a conical tube onto a chute that
 * exits at the +X edge, 4 levels down.
 */
export const vortexDef: PieceDef = {
  id: 'vortex',
  name: '漩涡碗',
  footprint: [-2, -1, 0, 1, 2].flatMap((x) => [-2, -1, 0, 1, 2].map((z) => ({ x, z }))),
  heightUnits: 1,
  ports: [
    { pos: v3(-2.5, 0, 0), dir: v3(-1, 0, 0), kind: 'in' },
    { pos: v3(2.5, -4 * H, 0), dir: v3(1, 0, 0), kind: 'out' },
  ],
  build() {
    const chuteY = -4 * H; // -2.0
    const rimR = 1.7;
    // Convex rim fillet (radius 0.6, marbles up to ~2.4 m/s stay in contact) rolling over into a
    // 27-degree cone. A 2.3 m/s marble orbits where v^2 / r = g * slope, i.e. around r = 1.1.
    const filletR = 0.6;
    const filletAngle = THREE.MathUtils.degToRad(45);
    const coneStartR = rimR - filletR * Math.sin(filletAngle);
    const coneStartY = -filletR * (1 - Math.cos(filletAngle));
    const coneSlope = 0.5;
    const holeR = 0.45;
    const tubeR = 0.3;
    const holeY = coneStartY - coneSlope * (coneStartR - holeR);
    const chuteTopY = chuteY + 0.3;
    const tubeBottom = chuteTopY + 0.5; // a full marble diameter above the chute deck, so nothing wedges under the rim
    const lipH = 0.2;
    const lipW = 0.08;

    // Bowl: closed lathe profile, listed from the rim inwards so normals face into the bowl.
    const inner: THREE.Vector2[] = [new THREE.Vector2(rimR, 0)];
    const filletSteps = 8;
    for (let i = 1; i <= filletSteps; i++) {
      const a = (filletAngle * i) / filletSteps;
      inner.push(new THREE.Vector2(rimR - filletR * Math.sin(a), -filletR * (1 - Math.cos(a))));
    }
    // Rounded hole lip: a sharp edge between the cone and the tube lets a slow marble sit in a
    // stable ring orbit (cradled by the edge and the cone). Roll the edge over instead.
    const lipR = 0.2;
    const coneDir = Math.atan(coneSlope); // cone descends inward at this angle
    const lipCenter = new THREE.Vector2(holeR + lipR, holeY + coneSlope * lipR - lipR / Math.cos(coneDir));
    const lipSteps = 6;
    for (let i = 0; i <= lipSteps; i++) {
      const a = Math.PI / 2 + coneDir + ((Math.PI / 2 - coneDir) * i) / lipSteps; // from cone normal to horizontal-inward
      inner.push(new THREE.Vector2(lipCenter.x + lipR * Math.cos(a), lipCenter.y + lipR * Math.sin(a)));
    }
    inner.push(new THREE.Vector2(tubeR, tubeBottom));
    const pts: THREE.Vector2[] = [
      ...inner,
      new THREE.Vector2(tubeR + 0.08, tubeBottom),
      new THREE.Vector2(holeR + 0.06, holeY - 0.3),
      ...[...inner].slice(1, filletSteps + 1).reverse().map((p) => new THREE.Vector2(p.x + 0.02, p.y - 0.08)),
      new THREE.Vector2(rimR, -0.08),
      new THREE.Vector2(rimR, 0),
    ];
    // Listed rim -> inwards/downwards -> shell back out: this orientation already gives normals that
    // face into the bowl (see funnel.ts for the opposite case), so no reversal here.
    const bowl = new THREE.LatheGeometry(pts, 72);
    bowl.computeVertexNormals();

    // Lead-in: arc of radius 1 from the -X edge, turning towards +Z, ending on the rim
    // at ~60 degrees where the heading is within 13 degrees of tangential.
    const theta = THREE.MathUtils.degToRad(60);
    const ease = (t: number) => t * t * (3 - 2 * t);
    const dease = (t: number) => 6 * t * (1 - t);
    const drop = -0.01;
    const leadIn = sweep(arcPath(v3(-2.5, 0, 1), 1, 0, theta, 1, (t) => ({ y: drop * ease(t), dy: drop * dease(t) })), 16);

    // Rim lip with a gap where the lead-in crosses. Lathe angle phi -> (r sin phi, y, r cos phi).
    const release = v3(-2.5 + Math.sin(theta), 0, 1 - Math.cos(theta));
    const phiEntry = Math.atan2(-2.5, 0); // -pi/2
    const phiRelease = Math.atan2(release.x, release.z);
    const halfW = 0.36 / rimR + 0.04;
    const gapStart = Math.min(phiEntry, phiRelease) - halfW;
    const gapEnd = Math.max(phiEntry, phiRelease) + halfW;
    const lipPts = [
      new THREE.Vector2(rimR - lipW, -0.02),
      new THREE.Vector2(rimR - lipW, lipH),
      new THREE.Vector2(rimR + lipW, lipH),
      new THREE.Vector2(rimR + lipW, -0.08),
      new THREE.Vector2(rimR - lipW, -0.02),
    ];
    lipPts.reverse();
    const lip = new THREE.LatheGeometry(lipPts, 72, gapEnd, Math.PI * 2 - (gapEnd - gapStart));
    lip.computeVertexNormals();

    // Exit chute: back wall behind the tube, slopes down to the +X edge.
    const chute = sweep(slopePath(v3(-0.6, chuteTopY, 0), v3(2.5, chuteY, 0)), 24);

    // Landing box under the tube: walls up to the tube bottom (back + both sides, open towards the exit),
    // so marbles bouncing off each other cannot escape between the rails and the tube rim.
    const wallTop = tubeBottom + 0.02;
    const wallBottom = chuteTopY - 0.08;
    const wallMid = (wallTop + wallBottom) / 2;
    const wallHalf = (wallTop - wallBottom) / 2;
    const landingBox = mergeGeometries([
      boxGeo(v3(-0.63, wallMid, 0), v3(0.03, wallHalf, 0.42)),
      boxGeo(v3(-0.05, wallMid, 0.39), v3(0.55, wallHalf, 0.03)),
      boxGeo(v3(-0.05, wallMid, -0.39), v3(0.55, wallHalf, 0.03)),
    ]);

    const legGeos: THREE.BufferGeometry[] = [];
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const g = new THREE.BoxGeometry(0.12, -chuteY + 0.05, 0.12);
      g.translate(sx * 1.35, chuteY / 2 - 0.02, sz * 1.35);
      legGeos.push(g);
    }

    return {
      parts: [
        { geometry: bowl, material: 'wood' },
        { geometry: lip, material: 'dark' },
        { geometry: leadIn, material: 'wood' },
        { geometry: chute, material: 'wood' },
        { geometry: landingBox, material: 'dark' },
        ...legGeos.map((geometry) => ({ geometry, material: 'dark' as const, collide: false })),
      ],
    };
  },
};
