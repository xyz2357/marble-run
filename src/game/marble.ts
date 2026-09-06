import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/world';

export const MARBLE_RADIUS = 0.15;

export type MarbleShape = 'ball' | 'egg';
export const MARBLE_SHAPES: { id: MarbleShape; name: string }[] = [
  { id: 'ball', name: '圆球' },
  { id: 'egg', name: '鸡蛋' },
];

export interface Marble {
  id: number;
  shape: MarbleShape;
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

/**
 * Egg: two half-spheroids sharing the same waist. Slightly narrower than the
 * ball so it still fits the trough; the pointed end is longer than the round end.
 */
const EGG_WAIST = 0.135;
const EGG_ROUND = 0.15;
const EGG_POINT = 0.21;

function eggProfile(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    // y from the round end (-EGG_ROUND) to the pointed end (+EGG_POINT)
    const a = -Math.PI / 2 + (Math.PI * i) / n;
    const s = Math.sin(a);
    const y = s < 0 ? s * EGG_ROUND : s * EGG_POINT;
    const r = Math.max(0, EGG_WAIST * Math.cos(a));
    pts.push(new THREE.Vector2(r, y));
  }
  return pts;
}

const eggGeo = new THREE.LatheGeometry(eggProfile(), 28);
eggGeo.computeVertexNormals();

/** Unique vertex positions of the egg for its convex hull collider. */
const eggHullPoints = (() => {
  const p = eggGeo.getAttribute('position');
  const seen = new Set<string>();
  const out: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p.getX(i), p.getY(i), p.getZ(i));
  }
  return new Float32Array(out);
})();

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

export function spawnMarble(
  pw: PhysicsWorld,
  scene: THREE.Scene,
  pos: THREE.Vector3Like,
  color: number,
  simTime: number,
  shape: MarbleShape = 'ball',
  heading?: THREE.Vector3,
): Marble {
  // An egg starts lying on its side with its long axis across the track (so it rolls like a log
  // rather than tumbling end over end), with a little random yaw so runs differ.
  let rot: THREE.Quaternion;
  if (shape === 'egg') {
    const along = heading ? heading.clone().setY(0).normalize() : new THREE.Vector3(1, 0, 0);
    // After the X rotation the long axis (local Y) points along Z; yaw it to be perpendicular to `along`.
    const yaw = Math.atan2(along.z, -along.x) + (Math.random() - 0.5) * 0.3;
    rot = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  } else {
    rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, 0));
  }
  const rbDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y, pos.z)
    .setRotation(rot)
    .setCcdEnabled(true)
    // Marbles must never sleep: a gate or lift moving away from a resting marble would not wake it.
    .setCanSleep(false)
    .setLinearDamping(0.05)
    .setAngularDamping(0.15);
  const body = pw.world.createRigidBody(rbDesc);
  const colDesc = (shape === 'egg' ? RAPIER.ColliderDesc.convexHull(eggHullPoints)! : RAPIER.ColliderDesc.ball(MARBLE_RADIUS))
    .setRestitution(0.3)
    .setFriction(0.6)
    .setDensity(2.5);
  const collider = pw.world.createCollider(colDesc, body);

  const mat = new THREE.MeshPhysicalMaterial({
    map: swirlTexture(color),
    roughness: 0.12,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const mesh = new THREE.Mesh(shape === 'egg' ? eggGeo : sphereGeo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.quaternion.copy(rot);
  scene.add(mesh);
  pw.bind(body, mesh);

  return {
    id: nextId++,
    shape,
    body,
    collider,
    mesh,
    color,
    spawnTime: simTime,
    finishTime: null,
    prevVel: new THREE.Vector3(),
    pendingImpact: 0,
    timbre: Math.random(),
  };
}

export function removeMarble(pw: PhysicsWorld, scene: THREE.Scene, m: Marble): void {
  pw.unbind(m.body);
  pw.world.removeRigidBody(m.body);
  scene.remove(m.mesh);
  (m.mesh.material as THREE.Material).dispose();
}
