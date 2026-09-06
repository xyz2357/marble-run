import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { boxGeo, mergeGeometries } from '../geometry/sweep';
import { H, v3, type BuiltPiece, type Mechanism, type MechanismContext, type PieceDef } from './types';

const PIVOT_Y = 0.5;
const HALF_LEN = 1.42;
const TIP = Math.asin((PIVOT_Y - 0.03) / 1.42); // tipped exit end stops 3 cm above the next deck (no wedging in the gap)
const REST = 0; // level at rest (the counterweight holds it against this limit): a crawling marble still reaches the pivot

/** Plank geometry in the plank's own frame (deck top at y=0, pivot at the origin). */
function plankGeometry(): THREE.BufferGeometry {
  const deck = boxGeo(v3(0, -0.04, 0), v3(HALF_LEN, 0.04, 0.36));
  const railA = boxGeo(v3(0, 0.1, 0.33), v3(HALF_LEN, 0.1, 0.03));
  const railB = boxGeo(v3(0, 0.1, -0.33), v3(HALF_LEN, 0.1, 0.03));
  const weight = boxGeo(v3(-1.0, -0.14, 0), v3(0.15, 0.06, 0.2));
  return mergeGeometries([deck, railA, railB, weight]);
}

function makePlank(ctx: MechanismContext): Mechanism {
  const pivot = v3(0, PIVOT_Y, 0).applyQuaternion(ctx.quat).add(ctx.origin);
  const anchor = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pivot.x, pivot.y, pivot.z).setRotation(ctx.quat));
  const restQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), REST).premultiply(ctx.quat);
  const plank = ctx.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(pivot.x, pivot.y, pivot.z).setRotation(restQ).setAngularDamping(1.5).setCcdEnabled(true),
  );
  const mk = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, density: number) =>
    ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setDensity(density).setFriction(0.5), plank);
  mk(0, -0.04, 0, HALF_LEN, 0.04, 0.36, 0.4); // deck
  mk(0, 0.1, 0.33, HALF_LEN, 0.1, 0.03, 0.4); // rails
  mk(0, 0.1, -0.33, HALF_LEN, 0.1, 0.03, 0.4);
  mk(-1.0, -0.14, 0, 0.15, 0.06, 0.2, 1.2); // counterweight: rests entry-side down, a marble past the pivot tips it

  const jointData = RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  const joint = ctx.world.createImpulseJoint(jointData, anchor, plank, true) as RAPIER.RevoluteImpulseJoint;
  joint.setLimits(-TIP, REST);

  const mesh = new THREE.Mesh(plankGeometry(), new THREE.MeshStandardMaterial({ color: 0xd2a56d, roughness: 0.85, flatShading: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.root.add(mesh);
  ctx.bind(plank, mesh);

  return {
    update() {
      /* pure physics */
    },
    dispose() {
      ctx.unbind(plank);
      ctx.world.removeImpulseJoint(joint, true);
      ctx.world.removeRigidBody(plank);
      ctx.world.removeRigidBody(anchor);
      ctx.root.remove(mesh);
      mesh.geometry.dispose();
    },
  };
}

/**
 * Seesaw over 3 cells. The plank rests with its entry end just below level 1;
 * a marble rolling past the pivot tips it so the exit end drops to level 0.
 */
export const seesawDef: PieceDef = {
  id: 'seesaw',
  name: '跷跷板',
  footprint: [{ x: -1, z: 0 }, { x: 0, z: 0 }, { x: 1, z: 0 }],
  heightUnits: 2,
  ports: [
    { pos: v3(-1.5, H, 0), dir: v3(-1, 0, 0), kind: 'in' },
    { pos: v3(1.5, 0, 0), dir: v3(1, 0, 0), kind: 'out' },
  ],
  build(): BuiltPiece {
    // Post top must stay below the plank's underside (PIVOT_Y - 0.08, minus the tilt dip over the post width).
    const post = boxGeo(v3(0, 0.19, 0), v3(0.05, 0.19, 0.3));
    const base = boxGeo(v3(0, 0.02, 0), v3(0.3, 0.02, 0.4));
    const axle = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 12);
    axle.rotateX(Math.PI / 2);
    axle.translate(0, PIVOT_Y, 0);
    const preview = plankGeometry();
    preview.rotateZ(REST);
    preview.translate(0, PIVOT_Y, 0);
    return {
      parts: [
        { geometry: mergeGeometries([post, base]), material: 'dark' },
        { geometry: axle, material: 'dark', collide: false },
      ],
      preview: [{ geometry: preview, material: 'wood' }],
      mechanisms: [makePlank],
    };
  },
};
