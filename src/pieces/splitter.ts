import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { RAIL_HEIGHT, slopePath, sweep, TRACK_HALF_WIDTH, TROUGH_HALF, troughY, type Profile } from '../geometry/sweep';
import { H, v3, type BuiltPiece, type Mechanism, type MechanismContext, type PieceDef } from './types';

/** 3 cells long, 3 wide: entry at the -X edge of the centre row, exits at the +X edge of the outer rows. */
const FOOTPRINT = [0, 1, 2].flatMap((x) => [-1, 0, 1].map((z) => ({ x, z })));
/** The flap pivots right at the divider tip (where the channels separate), so the trough
 *  cannot re-centre a deflected marble before it is committed to one side. */
const FLAP_ANGLE = THREE.MathUtils.degToRad(17);
const FLAP_PIVOT = v3(1.05, 0, 0);
const FLAP_LEN = 1.05;
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
 * Cross-section of the whole Y at a given x, perpendicular to X: one closed CCW
 * polygon with a constant vertex count (30). The floor is the union of the two
 * channels' troughs (a "W" whose ridge rises from the shared floor as the
 * centres move apart). Each channel keeps nine floor samples between its far
 * edge and the ridge; once the troughs no longer overlap, six middle points
 * grow into the two middle rails and the notch between them. Continuous in x,
 * never degenerate.
 */
function yProfile(x: number): Profile {
  const cL = branchZ(-1, x);
  const cR = branchZ(1, x);
  const m = (cL + cR) / 2;
  const r = cR - m; // half separation of the channel centres
  const floorAt = (z: number) => Math.min(troughY(z - cR), troughY(z - cL));
  const ridgeY = troughY(r);
  const k = smooth(THREE.MathUtils.clamp((r - TROUGH_HALF) / 0.1, 0, 1)); // middle rails rising
  const railTop = ridgeY + (RAIL_HEIGHT - ridgeY) * k;
  const notchY = ridgeY - (ridgeY + 0.02) * k;

  const zA = Math.max(cR - TROUGH_HALF, m + 0.03);
  const zB = Math.max(cR - TRACK_HALF_WIDTH, m + 0.01);
  const zD = Math.min(cL + TRACK_HALF_WIDTH, m - 0.01);
  const zF = Math.min(cL + TROUGH_HALF, m - 0.03);
  const samples = (from: number, to: number) =>
    Array.from({ length: 9 }, (_, i): [number, number] => {
      const z = from + ((to - from) * i) / 8;
      return [z, floorAt(z)];
    });
  const rightFloor = samples(cR + TROUGH_HALF, zA);
  const leftFloor = samples(zF, cL - TROUGH_HALF);
  const middle: [number, number][] = [
    [zA, railTop],
    [zB, railTop],
    [zB, notchY],
    [zD, notchY],
    [zD, railTop],
    [zF, railTop],
  ];
  return [
    [cL - TRACK_HALF_WIDTH, RAIL_HEIGHT],
    [cL - TRACK_HALF_WIDTH, -0.08],
    [cR + TRACK_HALF_WIDTH, -0.08],
    [cR + TRACK_HALF_WIDTH, RAIL_HEIGHT],
    [cR + TROUGH_HALF, RAIL_HEIGHT],
    ...rightFloor,
    ...middle,
    ...leftFloor,
    [cL - TROUGH_HALF, RAIL_HEIGHT],
  ];
}

/**
 * The Y drops one level in the flow direction so slow marbles never stall in it:
 * the splitter is high at the entry, the merge is high at its two entries.
 */
function buildY(flow: 'split' | 'merge'): THREE.BufferGeometry {
  const path = flow === 'split' ? slopePath(v3(-0.5, H, 0), v3(END_X, 0, 0)) : slopePath(v3(-0.5, 0, 0), v3(END_X, H, 0));
  return sweep(path, 72, (t) => yProfile(-0.5 + (END_X + 0.5) * t));
}

/** Deck height of the splitter at local x (entry side high). */
function splitDeckY(x: number): number {
  const t = (x + 0.5) / (END_X + 0.5);
  return H * (1 - smooth(t));
}

/** Kinematic flap at the fork that alternates sides after every marble. */
/** Flap blade in the pivot frame: extends backwards (-X), lower edge tilted to follow the sloping deck. */
function flapBlade(): { geometry: THREE.BufferGeometry; tilt: number } {
  const tilt = Math.atan((splitDeckY(FLAP_PIVOT.x - FLAP_LEN) - splitDeckY(FLAP_PIVOT.x)) / FLAP_LEN);
  const geometry = new THREE.BoxGeometry(FLAP_LEN, 0.2, 0.04);
  geometry.translate(-FLAP_LEN / 2, 0.09, 0);
  geometry.rotateZ(-tilt);
  return { geometry, tilt };
}

/** Centre of the blade box after tilting about the pivot. */
function tiltedOffset(tilt: number): [number, number, number] {
  const c = new THREE.Vector3(-FLAP_LEN / 2, 0.09, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), -tilt);
  return [c.x, c.y, c.z];
}

function makeFlap(ctx: MechanismContext, random = false): Mechanism {
  const pivotLocal = FLAP_PIVOT.clone().setY(splitDeckY(FLAP_PIVOT.x));
  const pivotWorld = pivotLocal.clone().applyQuaternion(ctx.quat).add(ctx.origin);
  const body = ctx.world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pivotWorld.x, pivotWorld.y, pivotWorld.z).setRotation(ctx.quat),
  );
  const blade = flapBlade();
  ctx.world.createCollider(
    RAPIER.ColliderDesc.cuboid(FLAP_LEN / 2, 0.1, 0.02)
      .setTranslation(...tiltedOffset(blade.tilt))
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -blade.tilt))
      .setFriction(0.3),
    body,
  );
  const mesh = new THREE.Mesh(blade.geometry, new THREE.MeshStandardMaterial({ color: 0xe0574f, roughness: 0.7 }));
  mesh.castShadow = true;
  ctx.root.add(mesh);
  ctx.bind(body, mesh);

  // Like a mechanical toggle: the flap only flips once a marble has gone past it, and
  // only when no other marble is still in the flap zone (a closely following marble
  // would otherwise be squeezed between the swinging flap and the rail).
  const zone = new THREE.Box3(v3(-0.6, -0.2, -1.2), v3(FLAP_PIVOT.x + 0.15, 0.9, 1.2));
  const inside = new Set<number>();
  let pendingFlip = false;
  let side: 1 | -1 = random && Math.random() < 0.5 ? -1 : 1; // branch the current flap position sends marbles to
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
          if (local.x > FLAP_PIVOT.x + 0.15) pendingFlip = true; // went through: flip for the next marble
        }
      }
      if (pendingFlip && inside.size === 0) {
        pendingFlip = false;
        side = random ? (Math.random() < 0.5 ? -1 : 1) : side === 1 ? -1 : 1;
        target = -side * FLAP_ANGLE;
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
  const g = flapBlade().geometry;
  g.rotateY(-FLAP_ANGLE);
  g.translate(FLAP_PIVOT.x, splitDeckY(FLAP_PIVOT.x), FLAP_PIVOT.z);
  return g;
}

/** Splitter: one entry, two parallel exits; a flap sends marbles left and right alternately. */
export const splitterDef: PieceDef = {
  id: 'splitter',
  name: '分叉器',
  family: { id: 'splitter', label: '交替' },
  footprint: FOOTPRINT,
  heightUnits: 2,
  ports: [
    { pos: v3(-0.5, H, 0), dir: v3(-1, 0, 0), kind: 'in' },
    { pos: v3(2.5, 0, 1), dir: v3(1, 0, 0), kind: 'out' },
    { pos: v3(2.5, 0, -1), dir: v3(1, 0, 0), kind: 'out' },
  ],
  build(): BuiltPiece {
    return {
      parts: [{ geometry: buildY('split'), material: 'wood' }],
      preview: [{ geometry: flapPreview(), material: 'accent' }],
      mechanisms: [makeFlap],
    };
  },
};

/** Random splitter: same Y and flap, but each marble is sent to a random side. */
export const splitterRandomDef: PieceDef = {
  ...splitterDef,
  id: 'splitter_rnd',
  name: '随机分叉',
  family: { id: 'splitter', label: '随机' },
  build(): BuiltPiece {
    return {
      parts: [{ geometry: buildY('split'), material: 'wood' }],
      preview: [{ geometry: flapPreview(), material: 'accent' }],
      mechanisms: [(ctx) => makeFlap(ctx, true)],
    };
  },
};

/** Merge: two parallel entries join into one exit (same Y, no flap). */
export const mergeDef: PieceDef = {
  id: 'merge',
  name: '合流',
  footprint: FOOTPRINT,
  heightUnits: 2,
  ports: [
    { pos: v3(-0.5, 0, 0), dir: v3(-1, 0, 0), kind: 'out' },
    { pos: v3(2.5, H, 1), dir: v3(1, 0, 0), kind: 'in' },
    { pos: v3(2.5, H, -1), dir: v3(1, 0, 0), kind: 'in' },
  ],
  build(): BuiltPiece {
    return { parts: [{ geometry: buildY('merge'), material: 'wood' }] };
  },
};
