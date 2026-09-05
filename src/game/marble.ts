import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/world';

export const MARBLE_RADIUS = 0.15;

export interface Marble {
  id: number;
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  color: number;
}

let nextId = 1;
const sphereGeo = new THREE.SphereGeometry(MARBLE_RADIUS, 32, 24);

export function spawnMarble(
  pw: PhysicsWorld,
  scene: THREE.Scene,
  pos: THREE.Vector3Like,
  color = 0x3aa0ff,
): Marble {
  const rbDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y, pos.z)
    .setCcdEnabled(true)
    .setLinearDamping(0.1)
    .setAngularDamping(0.25);
  const body = pw.world.createRigidBody(rbDesc);
  const colDesc = RAPIER.ColliderDesc.ball(MARBLE_RADIUS)
    .setRestitution(0.3)
    .setFriction(0.6)
    .setDensity(2.5);
  pw.world.createCollider(colDesc, body);

  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.15, metalness: 0.1 });
  const mesh = new THREE.Mesh(sphereGeo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  pw.bind(body, mesh);

  return { id: nextId++, body, mesh, color };
}

export function removeMarble(pw: PhysicsWorld, scene: THREE.Scene, m: Marble): void {
  pw.unbind(m.body);
  pw.world.removeRigidBody(m.body);
  scene.remove(m.mesh);
  (m.mesh.material as THREE.Material).dispose();
}
