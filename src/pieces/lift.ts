import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { boxGeo, lerpProfile, linePath, mergeGeometries, slopePath, sweep, TRACK_PROFILE, TROUGH_HALF } from '../geometry/sweep';
import { H, v3, type BuiltPiece, type Mechanism, type MechanismContext, type PieceDef } from './types';

/** Shaft interior in x (piece-local); the entry approach ends at CAR_X0, the exit deck starts at CAR_X1. */
const CAR_X0 = 0.1;
const CAR_X1 = 0.9;
const FLOOR_Y0 = -0.12; // car floor at the entry side, bottom position
const FLOOR_DROP = 0.08; // floor slants down towards the exit side
const GATE_X = 0.0;

const T_BOTTOM = 1.6; // gate open, marbles roll in
const T_CLOSE = 0.4; // gate closing
const T_RISE = 2.6;
const T_TOP = 2.0;
/** The exit deck slopes away from the shaft by this much, so marbles never linger and roll back in. */
const EXIT_DROP = 0.08;
/** The car stops this much above the exit deck's start so marbles drop onto it with a little speed. */
const TOP_LIP = 0.03;
const T_FALL = 2.0;
const CYCLE = T_BOTTOM + T_CLOSE + T_RISE + T_TOP + T_FALL;

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Elevator lift: marbles queue behind a gate on a short downhill approach; when
 * the car is at the bottom the gate drops and they roll onto the car's slanted
 * floor. The car rises `levels` levels and the marbles roll out onto the exit
 * deck. Lets a track loop back to its start.
 */
export function liftDef(levels: number): PieceDef {
  const rise = levels * H;
  const travel = rise + EXIT_DROP + TOP_LIP - (FLOOR_Y0 - FLOOR_DROP); // exit-side floor edge stops just above the deck start
  return {
    id: `lift${levels}`,
    name: `电梯 ↑${levels}`,
    family: { id: 'lift', label: `↑${levels}` },
    footprint: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
    ],
    heightUnits: levels + 1,
    ports: [
      { pos: v3(-0.5, 0, 0), dir: v3(-1, 0, 0), kind: 'in' },
      { pos: v3(1.5, rise, 0), dir: v3(1, 0, 0), kind: 'out' },
    ],
    build(): BuiltPiece {
      const parts: BuiltPiece['parts'] = [];
      // Approach: slopes down from the entry port to the car floor level.
      parts.push({ geometry: sweep(slopePath(v3(-0.5, 0, 0), v3(CAR_X0, FLOOR_Y0, 0)), 8), material: 'wood' });
      // Exit deck at the top: starts flat (the car floor is flat, marbles arrive at any z) and
      // morphs into the standard trough by the port.
      const flat = TRACK_PROFILE.map(([sv, u]) => [sv, Math.abs(sv) <= TROUGH_HALF + 1e-6 && u < 0.2 ? 0 : u] as [number, number]);
      parts.push({
        geometry: sweep(slopePath(v3(CAR_X1, rise + EXIT_DROP, 0), v3(1.5, rise, 0)), 10, (t) => lerpProfile(flat, TRACK_PROFILE, smooth(t))),
        material: 'wood',
      });

      // Static shaft: +X wall (stops marbles leaving until the top), -X wall above the entry opening, side walls.
      const shaftTop = rise + 0.45;
      const shaftBottom = FLOOR_Y0 - FLOOR_DROP - 0.3;
      const mid = (a: number, b: number) => (a + b) / 2;
      const half = (a: number, b: number) => Math.abs(a - b) / 2;
      const exitDeckBottom = rise + EXIT_DROP - 0.08;
      const walls = mergeGeometries([
        boxGeo(v3(CAR_X1 + 0.03, mid(shaftBottom, exitDeckBottom - 0.02), 0), v3(0.03, half(shaftBottom, exitDeckBottom - 0.02), 0.42)),
        boxGeo(v3(CAR_X0 - 0.03, mid(0.3, shaftTop), 0), v3(0.03, half(0.3, shaftTop), 0.42)),
        boxGeo(v3(mid(CAR_X0 - 0.06, CAR_X1 + 0.06), mid(shaftBottom, shaftTop), 0.39), v3(half(CAR_X0 - 0.06, CAR_X1 + 0.06), half(shaftBottom, shaftTop), 0.03)),
        boxGeo(v3(mid(CAR_X0 - 0.06, CAR_X1 + 0.06), mid(shaftBottom, shaftTop), -0.39), v3(half(CAR_X0 - 0.06, CAR_X1 + 0.06), half(shaftBottom, shaftTop), 0.03)),
        // Back wall at the top so marbles cannot roll off the -X side of the exit deck region.
        boxGeo(v3(CAR_X0 - 0.03, rise + 0.2, 0), v3(0.03, 0.25, 0.42)),
      ]);
      parts.push({ geometry: walls, material: 'dark' });
      // Shaft floor (visual + catches anything that slips), and a roof cap.
      parts.push({ geometry: boxGeo(v3(mid(CAR_X0, CAR_X1), shaftBottom - 0.02, 0), v3(half(CAR_X0, CAR_X1) + 0.06, 0.02, 0.42)), material: 'dark' });

      const preview = [carGeometry(0), gateGeometry(true)];
      return {
        parts,
        preview: [
          { geometry: preview[0], material: 'wood' },
          { geometry: preview[1], material: 'accent' },
        ],
        mechanisms: [(ctx) => makeLift(ctx, travel)],
      };
    },
  };
}

function carGeometry(offsetY: number): THREE.BufferGeometry {
  const len = CAR_X1 - CAR_X0;
  const g = new THREE.BoxGeometry(len / Math.cos(Math.atan(FLOOR_DROP / len)), 0.06, 0.72);
  g.rotateZ(-Math.atan(FLOOR_DROP / len));
  g.translate((CAR_X0 + CAR_X1) / 2, FLOOR_Y0 - FLOOR_DROP / 2 - 0.03 + offsetY, 0);
  return g;
}

function gateGeometry(up: boolean): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.05, 0.34, 0.6);
  g.translate(GATE_X, (up ? FLOOR_Y0 + 0.17 : FLOOR_Y0 - 0.4) + 0.0, 0);
  return g;
}

function makeLift(ctx: MechanismContext, travel: number): Mechanism {
  const world = ctx.world;
  const mk = (geo: THREE.BufferGeometry, color: number) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(ctx.origin.x, ctx.origin.y, ctx.origin.z).setRotation(ctx.quat));
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const center = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3());
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    ctx.root.add(mesh);
    ctx.bind(body, mesh);
    return { body, mesh, center, size };
  };

  // Car: one slanted slab (rotated cuboid collider).
  const len = CAR_X1 - CAR_X0;
  const tilt = -Math.atan(FLOOR_DROP / len);
  const car = mk(carGeometry(0), 0xd2a56d);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(len / Math.cos(tilt) / 2, 0.03, 0.36)
      .setTranslation((CAR_X0 + CAR_X1) / 2, FLOOR_Y0 - FLOOR_DROP / 2 - 0.03, 0)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt))
      .setFriction(0.4),
    car.body,
  );
  const gate = mk(gateGeometry(true), 0xe0574f);
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.025, 0.17, 0.3).setTranslation(GATE_X, FLOOR_Y0 + 0.17, 0), gate.body);

  let t = 0;
  let gateDown = 1; // 1 = fully lowered (open), 0 = raised (closed)
  const local = new THREE.Vector3();
  const inv = ctx.quat.clone().invert();
  const setPos = (body: RAPIER.RigidBody, dy: number) => {
    local.set(0, dy, 0).applyQuaternion(ctx.quat).add(ctx.origin);
    body.setNextKinematicTranslation({ x: local.x, y: local.y, z: local.z });
  };

  return {
    update(dt, marbles) {
      // The cycle only advances past the closing phase once the gate is actually shut,
      // and the gate never rises while a marble is over it (it would be launched).
      let carY = 0;
      let wantDown = 1;
      if (t < T_BOTTOM) {
        wantDown = 1;
      } else if (t < T_BOTTOM + T_CLOSE) {
        wantDown = 0;
      } else if (t < T_BOTTOM + T_CLOSE + T_RISE) {
        wantDown = 0;
        carY = travel * smooth((t - T_BOTTOM - T_CLOSE) / T_RISE);
      } else if (t < T_BOTTOM + T_CLOSE + T_RISE + T_TOP) {
        wantDown = 0;
        carY = travel;
      } else {
        const u = (t - T_BOTTOM - T_CLOSE - T_RISE - T_TOP) / T_FALL;
        carY = travel * (1 - smooth(u));
        wantDown = u > 0.85 ? 1 : 0;
      }
      let blocked = false;
      if (wantDown === 0 && gateDown > 0) {
        for (const m of marbles) {
          local.copy(m.pos).sub(ctx.origin).applyQuaternion(inv);
          if (Math.abs(local.x - GATE_X) < 0.24 && Math.abs(local.z) < 0.4 && local.y > -0.4 && local.y < 0.6) {
            blocked = true;
            break;
          }
        }
      }
      const speed = dt / 0.3;
      if (!blocked) gateDown += THREE.MathUtils.clamp(wantDown - gateDown, -speed, speed);
      const closingPhase = t >= T_BOTTOM && t < T_BOTTOM + T_CLOSE;
      if (closingPhase && gateDown > 0.001) t = Math.min(t + dt, T_BOTTOM + T_CLOSE - 0.001); // wait until shut
      else t = (t + dt) % CYCLE;
      setPos(car.body, carY);
      setPos(gate.body, -0.4 * smooth(gateDown));
    },
    dispose() {
      for (const p of [car, gate]) {
        ctx.unbind(p.body);
        world.removeRigidBody(p.body);
        ctx.root.remove(p.mesh);
        p.mesh.geometry.dispose();
      }
    },
  };
}
