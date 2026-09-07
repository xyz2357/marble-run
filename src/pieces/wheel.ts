import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { boxGeo, mergeGeometries, ringShell, slopePath, sweep } from '../geometry/sweep';
import { H, v3, type BuiltPiece, type Mechanism, type MechanismContext, type PieceDef } from './types';

/**
 * Water wheel over 2 cells: marbles fall from the entry deck (4 levels up) down a
 * short shaft into a compartment of a slowly turning paddle wheel, ride it down
 * inside a casing and are let out at the front onto the exit deck. Motorised
 * (kinematic), so it keeps turning at a steady pace.
 *
 * The shaft's front wall stops the marble's forward speed but its bottom edge is
 * a full marble diameter above the rim: a marble sitting on the blade tips is
 * pushed out under it instead of being squeezed between wall and blade (which
 * used to launch marbles out of the wheel sideways).
 */
const R = 0.55;
const HUB = 0.12;
const BLADES = 8;
const CENTER = v3(0, 0.85, 0); // top of the wheel (1.40) clears the entry deck's underside (1.42)
const HALF_W = 0.37; // blade half width (z)
const DISC_Z = 0.41; // side discs sit outside the blades; a marble inside a compartment cannot rest on their rims
const CASING_HALF_Z = 0.47;
const ENTRY_Y = 4 * H;
const CASING_IN = R + 0.03;
const CASING_OUT = R + 0.08;
const CASING_FROM = THREE.MathUtils.degToRad(125); // just under the entry deck
const CASING_TO = THREE.MathUtils.degToRad(320); // exit lip (-40 degrees), reached the long way round the bottom
const EXIT_DECK = v3(0.52, 0.42, 0);

function wheelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hub = new THREE.CylinderGeometry(HUB, HUB, DISC_Z * 2, 24);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);
  for (let i = 0; i < BLADES; i++) {
    const a = (i / BLADES) * Math.PI * 2;
    const b = new THREE.BoxGeometry(R - HUB + 0.02, 0.03, HALF_W * 2);
    b.translate((R + HUB) / 2 - 0.01, 0, 0);
    b.rotateZ(a);
    parts.push(b);
  }
  // Open rims (the colliders are full discs) so the marbles riding inside stay visible.
  for (const z of [DISC_Z, -DISC_Z]) {
    const ring = ringShell(v3(0, 0, z), R - 0.07, R, 0.012, Math.PI * 2, 0, 48);
    parts.push(ring);
  }
  const g = mergeGeometries(parts);
  g.translate(CENTER.x, CENTER.y, CENTER.z);
  return g;
}

/** @param period seconds per revolution */
export function wheelDef(period = 5): PieceDef {
  return {
  id: period === 5 ? 'wheel' : 'wheel_fast',
  name: '水车',
  family: { id: 'wheel', label: period === 5 ? '慢' : '快' },
  footprint: [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
  ],
  heightUnits: 5,
  ports: [
    { pos: v3(-0.5, ENTRY_Y, 0), dir: v3(-1, 0, 0), kind: 'in' },
    { pos: v3(1.5, 0, 0), dir: v3(1, 0, 0), kind: 'out' },
  ],
  build(): BuiltPiece {
    // The deck ends just before the top of the wheel; the marble flies off it into the drop shaft.
    const entry = sweep(slopePath(v3(-0.5, ENTRY_Y, 0), v3(-0.2, ENTRY_Y - 0.01, 0)), 4);
    const exit = sweep(slopePath(EXIT_DECK, v3(1.5, 0, 0)), 16);
    const casing = ringShell(CENTER, CASING_IN, CASING_OUT, CASING_HALF_Z, CASING_FROM, CASING_TO, 48);
    // Drop shaft above the wheel: front wall (bottom edge one marble diameter above the rim), back wall
    // down to the casing, side walls keeping the marble over the blades.
    const rimTop = CENTER.y + R;
    const shaftTop = ENTRY_Y + 0.45;
    const mid = (a: number, b: number) => (a + b) / 2;
    const half = (a: number, b: number) => Math.abs(a - b) / 2;
    const stop = mergeGeometries([
      boxGeo(v3(0.22, mid(rimTop + 0.32, shaftTop), 0), v3(0.02, half(rimTop + 0.32, shaftTop), CASING_HALF_Z)),
      boxGeo(v3(-0.38, mid(rimTop + 0.02, ENTRY_Y - 0.08), 0), v3(0.02, half(rimTop + 0.02, ENTRY_Y - 0.08), CASING_HALF_Z)),
      boxGeo(v3(-0.08, mid(rimTop + 0.02, shaftTop), CASING_HALF_Z - 0.02), v3(0.32, half(rimTop + 0.02, shaftTop), 0.02)),
      boxGeo(v3(-0.08, mid(rimTop + 0.02, shaftTop), -(CASING_HALF_Z - 0.02)), v3(0.32, half(rimTop + 0.02, shaftTop), 0.02)),
    ]);
    const stand = mergeGeometries([
      boxGeo(v3(0, CENTER.y / 2, CASING_HALF_Z + 0.05), v3(0.05, CENTER.y / 2, 0.03)),
      boxGeo(v3(0, CENTER.y / 2, -(CASING_HALF_Z + 0.05)), v3(0.05, CENTER.y / 2, 0.03)),
    ]);
    const axle = new THREE.CylinderGeometry(0.03, 0.03, (CASING_HALF_Z + 0.08) * 2, 12);
    axle.rotateX(Math.PI / 2);
    axle.translate(CENTER.x, CENTER.y, CENTER.z);
    return {
      parts: [
        { geometry: entry, material: 'wood' },
        { geometry: exit, material: 'wood' },
        { geometry: casing, material: 'glass' },
        { geometry: stop, material: 'glass' },
        { geometry: stand, material: 'dark', collide: false },
        { geometry: axle, material: 'dark', collide: false },
      ],
      preview: [{ geometry: wheelGeometry(), material: 'wood' }],
      mechanisms: [(ctx) => makeWheel(ctx, period)],
    };
  },
  };
}

function makeWheel(ctx: MechanismContext, PERIOD: number): Mechanism {
  const c = CENTER.clone().applyQuaternion(ctx.quat).add(ctx.origin);
  const body = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, c.y, c.z).setRotation(ctx.quat));
  const zq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const grip = (d: RAPIER.ColliderDesc) => d.setFriction(0.6).setRestitution(0).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min);
  ctx.world.createCollider(grip(RAPIER.ColliderDesc.cylinder(DISC_Z, HUB).setRotation(zq)), body);
  for (let i = 0; i < BLADES; i++) {
    const a = (i / BLADES) * Math.PI * 2;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
    const p = new THREE.Vector3((R + HUB) / 2 - 0.01, 0, 0).applyQuaternion(q);
    ctx.world.createCollider(grip(RAPIER.ColliderDesc.cuboid((R - HUB + 0.02) / 2, 0.015, HALF_W).setTranslation(p.x, p.y, p.z).setRotation(q)), body);
  }
  for (const z of [DISC_Z, -DISC_Z]) {
    ctx.world.createCollider(grip(RAPIER.ColliderDesc.cylinder(0.01, R).setTranslation(0, 0, z).setRotation(zq)), body);
  }
  const geo = wheelGeometry();
  geo.translate(-CENTER.x, -CENTER.y, -CENTER.z);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd2a56d, roughness: 0.85, flatShading: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.root.add(mesh);
  ctx.bind(body, mesh);

  let angle = 0;
  const q = new THREE.Quaternion();
  return {
    update(dt) {
      // Clockwise seen from +Z: the top of the wheel moves towards +X (entry to exit).
      angle -= ((Math.PI * 2) / PERIOD) * dt;
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle).premultiply(ctx.quat);
      body.setNextKinematicRotation(q);
    },
    dispose() {
      ctx.unbind(body);
      ctx.world.removeRigidBody(body);
      ctx.root.remove(mesh);
      geo.dispose();
    },
  };
}
