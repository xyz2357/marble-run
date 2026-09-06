import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { slopePath, sweep } from '../geometry/sweep';
import { H, v3, type BuiltPiece, type Mechanism, type MechanismContext, type PieceDef } from './types';

const PERIOD = 3.0;
const OPEN_FOR = 0.7;
const GATE_X = 0.25;

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Timed gate on a one-cell steep slope: a bar blocks the channel and drops for
 * OPEN_FOR seconds every PERIOD seconds, releasing whatever has queued behind it.
 * Handy as a race start or to space marbles out.
 */
export const gateDef: PieceDef = {
  id: 'gate',
  name: '定时闸门',
  footprint: [{ x: 0, z: 0 }],
  heightUnits: 2,
  ports: [
    { pos: v3(-0.5, H, 0), dir: v3(-1, 0, 0), kind: 'in' },
    { pos: v3(0.5, 0, 0), dir: v3(1, 0, 0), kind: 'out' },
  ],
  build(): BuiltPiece {
    const path = slopePath(v3(-0.5, H, 0), v3(0.5, 0, 0));
    const gateY = path((GATE_X + 0.5) / 1).pos.y;
    const bar = new THREE.BoxGeometry(0.05, 0.34, 0.6);
    bar.translate(GATE_X, gateY + 0.17, 0);
    return {
      parts: [{ geometry: sweep(path, 16), material: 'wood' }],
      preview: [{ geometry: bar, material: 'accent' }],
      mechanisms: [(ctx) => makeGate(ctx, gateY)],
    };
  },
};

function makeGate(ctx: MechanismContext, gateY: number): Mechanism {
  const body = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(ctx.origin.x, ctx.origin.y, ctx.origin.z).setRotation(ctx.quat));
  ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(0.025, 0.17, 0.3).setTranslation(GATE_X, gateY + 0.17, 0), body);
  const geo = new THREE.BoxGeometry(0.05, 0.34, 0.6);
  geo.translate(GATE_X, gateY + 0.17, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xe0574f, roughness: 0.7 }));
  mesh.castShadow = true;
  ctx.root.add(mesh);
  ctx.bind(body, mesh);

  let t = 0;
  let down = 0;
  const local = new THREE.Vector3();
  const inv = ctx.quat.clone().invert();
  return {
    update(dt, marbles) {
      t = (t + dt) % PERIOD;
      // Closed first (marbles queue), then down (open) for OPEN_FOR seconds at the end of each period.
      const o = t - (PERIOD - OPEN_FOR);
      const target = o >= 0 ? 1 : 0;
      // Never rise while a marble is over the bar (it would be launched); hold open until it has cleared.
      let blocked = false;
      if (target === 0 && down > 0) {
        for (const m of marbles) {
          local.copy(m.pos).sub(ctx.origin).applyQuaternion(inv);
          if (Math.abs(local.x - GATE_X) < 0.24 && Math.abs(local.z) < 0.4 && local.y > -0.3 && local.y < 0.8) {
            blocked = true;
            break;
          }
        }
      }
      const speed = dt / 0.2;
      if (!blocked) down += THREE.MathUtils.clamp(target - down, -speed, speed);
      local.set(0, -0.42 * smooth(down), 0).applyQuaternion(ctx.quat).add(ctx.origin);
      body.setNextKinematicTranslation({ x: local.x, y: local.y, z: local.z });
    },
    dispose() {
      ctx.unbind(body);
      ctx.world.removeRigidBody(body);
      ctx.root.remove(mesh);
      geo.dispose();
    },
  };
}
