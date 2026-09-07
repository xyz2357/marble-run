import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/world';

export const MARBLE_RADIUS = 0.15;

export type MarbleShape = 'ball' | 'egg';

export interface MarbleTypeDef {
  /** Stored in localStorage and used by the test seam; do not rename. */
  id: string;
  name: string;
  /** Which body to build. Only the egg is not a sphere. */
  shape: MarbleShape;
  /** Mass per volume. It cancels out of a marble simply rolling downhill, so it shows up where
   *  marbles push something back: the seesaw, the splitter flap, and each other in a pile-up. */
  density: number;
  restitution: number;
  friction: number;
  /**
   * Bounce needs asking for. Track colliders set the Min combine rule, and Rapier resolves a pair
   * by taking the higher-priority rule (Average < Min < Multiply < Max), so a marble that should
   * bounce has to request Max. Everything else leaves the track's Min in charge and behaves
   * exactly as it did before this existed.
   */
  bouncy?: boolean;
  /**
   * Rolling losses. Density cancels out of a marble simply rolling downhill, so this is what
   * actually makes a heavy marble feel heavy: less damping means it keeps rolling through flats
   * and long runs, more means it dies away. Per body, not a world setting.
   */
  linearDamping: number;
  angularDamping: number;
  /**
   * Finish. The per-marble race colour is kept in every case, so the race list stays readable;
   * `lighten` mixes it towards STEEL_TINT. Note metalness cannot go near 1 here: there is no
   * environment map in this scene, so a fully metallic ball has nothing to reflect and renders
   * black. Half-metal plus a light tint reads as polished metal under these lights.
   */
  look: { roughness: number; metalness: number; clearcoat: number; swirl: boolean; lighten?: number };
}

/** Selectable marbles, in play-bar order. */
export const MARBLE_TYPES: MarbleTypeDef[] = [
  {
    id: 'glass',
    name: '玻璃珠',
    shape: 'ball',
    density: 2.5,
    restitution: 0.3,
    friction: 0.6,
    linearDamping: 0.05,
    angularDamping: 0.15,
    look: { roughness: 0.12, metalness: 0, clearcoat: 1, swirl: true },
  },
  {
    id: 'steel',
    name: '钢珠',
    shape: 'ball',
    // Three times the glass marble's mass: it shoves lighter marbles aside and swings the
    // seesaw hard. Slick, so it also carries further through curves.
    density: 7.8,
    restitution: 0.2,
    friction: 0.25,
    // Barely damped: a steel marble carries through flats and long runs.
    linearDamping: 0.02,
    angularDamping: 0.04,
    look: { roughness: 0.12, metalness: 1, clearcoat: 0, swirl: false, lighten: 0.82 },
  },
  {
    id: 'rubber',
    name: '橡胶珠',
    shape: 'ball',
    density: 1.15,
    restitution: 0.15,
    friction: 0.95,
    bouncy: true,
    // Rubber gives energy back as bounce but eats it in rolling: lively, not fast.
    linearDamping: 0.09,
    angularDamping: 0.4,
    look: { roughness: 0.95, metalness: 0, clearcoat: 0, swirl: false },
  },
  {
    id: 'egg',
    name: '鸡蛋',
    shape: 'egg',
    density: 2.5,
    restitution: 0.3,
    friction: 0.6,
    linearDamping: 0.05,
    angularDamping: 0.15,
    look: { roughness: 0.55, metalness: 0, clearcoat: 0.15, swirl: false },
  },
];

const DEFAULT_TYPE = MARBLE_TYPES[0];
/** What `look.lighten` mixes a marble's race colour towards: a cool, desaturated metal grey. */
const STEEL_TINT = new THREE.Color(0xb9c0ca);

export function getMarbleType(id: string): MarbleTypeDef {
  return MARBLE_TYPES.find((t) => t.id === id) ?? DEFAULT_TYPE;
}

export interface Marble {
  id: number;
  /** Which MARBLE_TYPES entry this was spawned as. */
  type: string;
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
 * A metal has no diffuse colour: it only shows what it reflects, so a metallic marble with
 * nothing around it renders black. This 64x32 sky-to-ground gradient is all it needs.
 *
 * It hangs off the metal material only, NOT scene.environment: an environment on the scene makes
 * every material sample it every frame, which cost 60% of the render budget under software GL
 * (and PMREM-filtering a RoomEnvironment instead cost seconds per page load). Built lazily so a
 * run without a metal marble never pays for it.
 */
let envTex: THREE.Texture | null = null;
function metalEnvironment(): THREE.Texture {
  if (envTex) return envTex;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  // High contrast on purpose: a smooth wash reflects as a smooth wash and the ball reads as
  // pearl, not metal. A bright sky, a hard horizon and a dark floor give it something to show.
  const g = ctx.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.42, '#e8f2ff');
  g.addColorStop(0.5, '#7f8a95');
  g.addColorStop(0.52, '#3a4048');
  g.addColorStop(1, '#20242a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 32);
  // A couple of bright patches so the reflection has features to slide across as it rolls.
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(6, 3, 16, 7);
  ctx.fillRect(40, 6, 10, 5);
  envTex = new THREE.CanvasTexture(canvas);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.SRGBColorSpace;
  return envTex;
}

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

/**
 * Egg skin: the user's egg photo baked onto the lathe's UV layout by
 * scratch/make_egg_skin.py (face on the front half, shell colour elsewhere).
 */
const eggTexture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/egg-skin.png`);
eggTexture.colorSpace = THREE.SRGBColorSpace;
eggTexture.anisotropy = 4;

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
  typeId: string = DEFAULT_TYPE.id,
  heading?: THREE.Vector3,
): Marble {
  const type = getMarbleType(typeId);
  const shape = type.shape;
  // An egg starts lying on its side with its long axis across the track (so it rolls like a log
  // rather than tumbling end over end), with a little random yaw so runs differ.
  let rot: THREE.Quaternion;
  if (shape === 'egg') {
    const along = heading ? heading.clone().setY(0).normalize() : new THREE.Vector3(1, 0, 0);
    // After the X rotation the long axis (local Y) points along Z; yaw it to be perpendicular to `along`.
    const yaw = Math.atan2(along.z, -along.x) + (Math.random() - 0.5) * 0.3;
    // Rx(-90) turns the egg's local +Z (the face) to point up, so a fresh egg shows its face.
    rot = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
  } else {
    rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, 0));
  }
  const rbDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y, pos.z)
    .setRotation(rot)
    .setCcdEnabled(true)
    // Marbles must never sleep: a gate or lift moving away from a resting marble would not wake it.
    .setCanSleep(false)
    .setLinearDamping(type.linearDamping)
    .setAngularDamping(type.angularDamping);
  const body = pw.world.createRigidBody(rbDesc);
  const colDesc = (shape === 'egg' ? RAPIER.ColliderDesc.convexHull(eggHullPoints)! : RAPIER.ColliderDesc.ball(MARBLE_RADIUS))
    .setRestitution(type.restitution)
    .setFriction(type.friction)
    .setDensity(type.density);
  // See MarbleTypeDef.bouncy: only a marble that asks for Max overrides the track's Min.
  if (type.bouncy) colDesc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
  const collider = pw.world.createCollider(colDesc, body);

  // Eggs get the photo skin; every ball keeps its race colour and differs only in finish, so the
  // metal one reads as anodised steel and the rubber one as matte rubber.
  const mat =
    shape === 'egg'
      ? new THREE.MeshPhysicalMaterial({ map: eggTexture, roughness: type.look.roughness, metalness: 0, clearcoat: type.look.clearcoat, clearcoatRoughness: 0.5 })
      : new THREE.MeshPhysicalMaterial({
          envMap: type.look.metalness > 0.2 ? metalEnvironment() : null,
          envMapIntensity: 1.6,
          map: type.look.swirl ? swirlTexture(color) : undefined,
          color: type.look.swirl ? 0xffffff : new THREE.Color(color).lerp(STEEL_TINT, type.look.lighten ?? 0),
          roughness: type.look.roughness,
          metalness: type.look.metalness,
          clearcoat: type.look.clearcoat,
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
    type: type.id,
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
