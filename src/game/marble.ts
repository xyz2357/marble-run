import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/world';

export const MARBLE_RADIUS = 0.15;

export interface Marble {
  id: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  color: number;
  /** Simulation time (s) when spawned. */
  spawnTime: number;
  /** Simulation time (s) when it reached a goal, or null. */
  finishTime: number | null;
  /** Velocity at the previous physics step, for impact detection. */
  prevVel: THREE.Vector3;
  /** Largest per-step velocity change since the last audio update (m/s). */
  pendingImpact: number;
  /** 0..1, per-marble sound variation. */
  timbre: number;
}

let nextId = 1;
const sphereGeo = new THREE.SphereGeometry(MARBLE_RADIUS, 40, 28);
const textureCache = new Map<number, THREE.CanvasTexture>();

/** Glass marble with a lighter swirl: a small procedural canvas texture per colour. */
function swirlTexture(color: number): THREE.CanvasTexture {
  let tex = textureCache.get(color);
  if (tex) return tex;
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const base = new THREE.Color(color);
  const light = base.clone().lerp(new THREE.Color(0xffffff), 0.75);
  const dark = base.clone().lerp(new THREE.Color(0x000000), 0.25);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = i === 1 ? `#${dark.getHexString()}` : `#${light.getHexString()}`;
    ctx.lineWidth = i === 1 ? 6 : 14;
    ctx.beginPath();
    for (let x = -20; x <= w + 20; x += 4) {
      const y = h / 2 + Math.sin((x / w) * Math.PI * 2 + i * 1.7) * h * 0.28 + i * 8;
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  textureCache.set(color, tex);
  return tex;
}

export function spawnMarble(pw: PhysicsWorld, scene: THREE.Scene, pos: THREE.Vector3Like, color: number, simTime: number): Marble {
  const rbDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y, pos.z)
    .setCcdEnabled(true)
    .setLinearDamping(0.05)
    .setAngularDamping(0.15);
  const body = pw.world.createRigidBody(rbDesc);
  const colDesc = RAPIER.ColliderDesc.ball(MARBLE_RADIUS).setRestitution(0.3).setFriction(0.6).setDensity(2.5);
  const collider = pw.world.createCollider(colDesc, body);

  const mat = new THREE.MeshPhysicalMaterial({
    map: swirlTexture(color),
    roughness: 0.12,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const mesh = new THREE.Mesh(sphereGeo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
  scene.add(mesh);
  pw.bind(body, mesh);

  return { id: nextId++, body, collider, mesh, color, spawnTime: simTime, finishTime: null, prevVel: new THREE.Vector3(), pendingImpact: 0, timbre: Math.random() };
}

export function removeMarble(pw: PhysicsWorld, scene: THREE.Scene, m: Marble): void {
  pw.unbind(m.body);
  pw.world.removeRigidBody(m.body);
  scene.remove(m.mesh);
  (m.mesh.material as THREE.Material).dispose();
}
