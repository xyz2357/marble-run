import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { linePath, sweep, type Profile } from '../geometry/sweep';
import { v3, type BuiltPiece, type Mechanism, type MechanismContext, type PieceDef } from './types';

/** 3 cells long, 3 wide: entry at the -X edge of the centre row, exits at the +X edge of the outer rows. */
const FOOTPRINT = [0, 1, 2].flatMap((x) => [-1, 0, 1].map((z) => ({ x, z })));
const FLAP_ANGLE = THREE.MathUtils.degToRad(24);
const FLAP_PIVOT = v3(0.7, 0, 0);
const FLAP_LEN = 0.75;
const FORK_X = 0.1;
const END_X = 2.5;

/**
 * Branch centreline z as a function of x: a cubic lane change from (FORK_X, 0)
 * to (END_X, +-1), level at both ends. Steepest heading about 32 degrees.
 */
function branchZ(sign: 1 | -1, x: number): number {
  const t = THREE.MathUtils.clamp((x - FORK_X) / (END_X - FORK_X), 0, 1);
  return sign * t * t * (3 - 2 * t);
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Cross-section of the whole Y at a given x, perpendicular to X (one closed CCW
 * polygon, constant vertex count). Both channels share one deck. The eight points
 * that become the two middle rails and the notch between them lie spread out on
 * the flat deck until the channels separate (all triangles stay real and
 * coplanar, so no ghost edges), then glide into place as the rails rise.
 */
function yProfile(x: number): Profile {
  const cL = branchZ(-1, x);
  const cR = branchZ(1, x);
  const m = (cL + cR) / 2;
  const g = Math.max(0, cR - cL - 0.72); // gap between the two channels' deck edges
  const f = smooth(Math.min(1, g / 0.12)); // 0 = flat deck, 1 = rails fully formed
  const h = 0.2 * f;
  // Target (formed) positions of the eight middle points, right to left.
  const formed: [number, number][] = [
    [m + g / 2 + 0.06, 0],
    [m + g / 2 + 0.06, h],
    [m + g / 2, h],
    [m + g / 2, -0.02],
    [m - g / 2, -0.02],
    [m - g / 2, h],
    [m - g / 2 - 0.06, h],
    [m - g / 2 - 0.06, 0],
  ];
  // Flat positions: evenly spaced on the deck between the two chamfers.
  const right = cR + 0.16;
  const left = cL - 0.16;
  const flat: [number, number][] = formed.map((_, k) => [right + ((left - right) * (k + 1)) / 9, 0]);
  const middle = formed.map(([z, y], k) => [flat[k][0] + (z - flat[k][0]) * f, flat[k][1] + (y - flat[k][1]) * f] as [number, number]);
  return [
    [cL - 0.36, 0.2],
    [cL - 0.36, -0.08],
    [cR + 0.36, -0.08],
    [cR + 0.36, 0.2],
    [cR + 0.3, 0.2],
    [cR + 0.3, 0.06],
    [right, 0],
    ...middle,
    [left, 0],
    [cL - 0.3, 0.06],
    [cL - 0.3, 0.2],
  ];
}

function buildY(): THREE.BufferGeometry {
  return sweep(linePath(v3(-0.5, 0, 0), v3(END_X, 0, 0)), 72, (t) => yProfile(-0.5 + (END_X + 0.5) * t));
}

/** Kinematic flap at the fork that alternates sides after every marble. */
function makeFlap(ctx: MechanismContext): Mechanism {
  const pivotWorld = FLAP_PIVOT.clone().applyQuaternion(ctx.quat).add(ctx.origin);
  const body = ctx.world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pivotWorld.x, pivotWorld.y, pivotWorld.z).setRotation(ctx.quat),
  );
  // The flap extends backwards (-X) from the pivot.
  ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(FLAP_LEN / 2, 0.09, 0.02).setTranslation(-FLAP_LEN / 2, 0.09, 0).setFriction(0.3), body);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(FLAP_LEN, 0.18, 0.04), new THREE.MeshStandardMaterial({ color: 0xe0574f, roughness: 0.7 }));
  mesh.geometry.translate(-FLAP_LEN / 2, 0.09, 0);
  mesh.castShadow = true;
  ctx.root.add(mesh);
  ctx.bind(body, mesh);

  // Like a mechanical toggle: the flap only flips once a marble has gone past it,
  // so it never swings into a marble that is still being deflected.
  const zone = new THREE.Box3(v3(-0.6, -0.1, -1.2), v3(FLAP_PIVOT.x + 0.15, 0.5, 1.2));
  const inside = new Set<number>();
  let side: 1 | -1 = 1; // branch the current flap position sends marbles to (+Z first)
  let angle = -side * FLAP_ANGLE;
  let target = angle;
  const local = new THREE.Vector3();
  const inv = ctx.quat.clone().invert();
  const q = new THREE.Quaternion();

  return {
    update(dt, marbles) {
      for (const m of marbles) {
        local.copy(m.pos).sub(ctx.origin).applyQuaternion(inv);
        const now = zone.containsPoint(local);
        if (now && !inside.has(m.id)) {
          inside.add(m.id);
        } else if (!now && inside.has(m.id)) {
          inside.delete(m.id);
          if (local.x > FLAP_PIVOT.x + 0.15) {
            // Went through: flip for the next marble.
            side = side === 1 ? -1 : 1;
            target = -side * FLAP_ANGLE;
          }
        }
      }
      const speed = 12 * dt;
      angle += THREE.MathUtils.clamp(target - angle, -speed, speed);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle).premultiply(ctx.quat);
      body.setNextKinematicRotation(q);
    },
    dispose() {
      ctx.unbind(body);
      ctx.world.removeRigidBody(body);
      ctx.root.remove(mesh);
      mesh.geometry.dispose();
    },
  };
}

function flapPreview(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(FLAP_LEN, 0.18, 0.04);
  g.translate(-FLAP_LEN / 2, 0.09, 0);
  g.rotateY(-FLAP_ANGLE);
  g.translate(FLAP_PIVOT.x, FLAP_PIVOT.y, FLAP_PIVOT.z);
  return g;
}

/** Splitter: one entry, two parallel exits; a flap sends marbles left and right alternately. */
export const splitterDef: PieceDef = {
  id: 'splitter',
  name: '分叉器',
  footprint: FOOTPRINT,
  heightUnits: 1,
  ports: [
    { pos: v3(-0.5, 0, 0), dir: v3(-1, 0, 0), kind: 'in' },
    { pos: v3(2.5, 0, 1), dir: v3(1, 0, 0), kind: 'out' },
    { pos: v3(2.5, 0, -1), dir: v3(1, 0, 0), kind: 'out' },
  ],
  build(): BuiltPiece {
    return {
      parts: [{ geometry: buildY(), material: 'wood' }],
      preview: [{ geometry: flapPreview(), material: 'accent' }],
      mechanisms: [makeFlap],
    };
  },
};

/** Merge: two parallel entries join into one exit (same Y, no flap). */
export const mergeDef: PieceDef = {
  id: 'merge',
  name: '合流',
  footprint: FOOTPRINT,
  heightUnits: 1,
  ports: [
    { pos: v3(-0.5, 0, 0), dir: v3(-1, 0, 0), kind: 'out' },
    { pos: v3(2.5, 0, 1), dir: v3(1, 0, 0), kind: 'in' },
    { pos: v3(2.5, 0, -1), dir: v3(1, 0, 0), kind: 'in' },
  ],
  build(): BuiltPiece {
    return { parts: [{ geometry: buildY(), material: 'wood' }] };
  },
};
