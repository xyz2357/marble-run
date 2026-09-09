import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { trimeshArrays } from '../geometry/sweep';
import { getPiece } from '../pieces/registry';
import {
  H,
  CELL,
  placedCells,
  placedOrigin,
  placedQuat,
  rotY,
  worldPorts,
  type MarbleInfo,
  type MaterialKey,
  type Mechanism,
  type PieceDef,
  type PlacedPiece,
  type PortKind,
  type WorldPort,
} from '../pieces/types';
import type { PhysicsWorld } from '../physics/world';

export interface TrackPieceInstance {
  id: number;
  placed: PlacedPiece;
  def: PieceDef;
  group: THREE.Group;
  body: RAPIER.RigidBody;
  /** World-space spawn point, if any. */
  spawn?: THREE.Vector3;
  /** World-space goal box, if any. */
  goal?: THREE.Box3;
  mechanisms: Mechanism[];
}

/**
 * Procedural wood grain, one tile per metre. `sweep` writes UVs in metres with u along the path,
 * so the grain runs the way the track does; box parts carry BoxGeometry's own 0..1 UVs and get
 * one tile per face, which at this scale still reads as timber.
 *
 * Note flatShading has to go with it: it quantises the normal per triangle, which fights the
 * texture and makes the grain look faceted rather than painted on.
 */
function woodTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d2a56d';
  ctx.fillRect(0, 0, w, h);
  // Long grain lines along u, wandering slightly so they do not read as a barcode.
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * h;
    const dark = Math.random() < 0.5;
    ctx.strokeStyle = dark ? `rgba(120, 82, 45, ${0.05 + Math.random() * 0.16})` : `rgba(240, 208, 165, ${0.05 + Math.random() * 0.14})`;
    ctx.lineWidth = 0.6 + Math.random() * 2.4;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const yy = y + Math.sin(x * 0.02 + i) * 2.2 + Math.sin(x * 0.005 + i * 2) * 3.5;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  // A couple of knots.
  for (let i = 0; i < 2; i++) {
    const cx = Math.random() * w;
    const cy = Math.random() * h;
    for (let r = 9; r > 0; r--) {
      ctx.strokeStyle = `rgba(110, 74, 40, ${0.05 + 0.04 * (9 - r)})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 2.2, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const grain = woodTexture();

export const MATERIALS: Record<MaterialKey, THREE.Material> = {
  wood: new THREE.MeshStandardMaterial({ map: grain, roughness: 0.85, side: THREE.DoubleSide }),
  dark: new THREE.MeshStandardMaterial({ map: grain, color: 0x7a5533, roughness: 0.9, side: THREE.DoubleSide }),
  accent: new THREE.MeshStandardMaterial({ color: 0xe0574f, roughness: 0.7, side: THREE.DoubleSide }),
  goal: new THREE.MeshStandardMaterial({ color: 0x3ec46d, roughness: 0.7, side: THREE.DoubleSide }),
  // Tinted glass for shafts and casings. depthWrite off so the marble behind the near wall is
  // not hidden by it; shadows are skipped for these parts (see `place`) or they read as solid.
  glass: new THREE.MeshStandardMaterial({
    color: 0x9fd0e8,
    roughness: 0.1,
    metalness: 0,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
};

const colouredCache = new Map<string, THREE.Material>();

/** Shared material for a part, or a cached per-colour variant when the part sets `color`. */
export function materialFor(part: { material: MaterialKey; color?: number }): THREE.Material {
  if (part.color === undefined) return MATERIALS[part.material];
  const key = `${part.material}:${part.color}`;
  let m = colouredCache.get(key);
  if (!m) {
    m = (MATERIALS[part.material] as THREE.MeshStandardMaterial).clone();
    (m as THREE.MeshStandardMaterial).color.set(part.color);
    colouredCache.set(key, m);
  }
  return m;
}

/** Holds all placed pieces: their meshes, static physics bodies, spawn points and goals. */
export class Track {
  readonly pieces: TrackPieceInstance[] = [];
  readonly root = new THREE.Group();
  private nextId = 1;

  constructor(
    private physics: PhysicsWorld,
    scene: THREE.Scene,
  ) {
    scene.add(this.root);
  }

  place(placed: PlacedPiece): TrackPieceInstance {
    const def = getPiece(placed.def);
    const built = def.build();
    const origin = placedOrigin(placed);
    const quat = placedQuat(placed);

    const group = new THREE.Group();
    group.position.copy(origin);
    group.quaternion.copy(quat);
    for (const part of built.parts) {
      const mesh = new THREE.Mesh(part.geometry, materialFor(part));
      // A see-through part that cast or received shadows would read as solid again.
      mesh.castShadow = part.material !== 'glass';
      mesh.receiveShadow = part.material !== 'glass';
      group.add(mesh);
    }
    this.root.add(group);

    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(origin.x, origin.y, origin.z).setRotation(quat),
    );
    for (const part of built.parts) {
      if (part.collide === false) continue;
      const { vertices, indices } = trimeshArrays(part.geometry);
      const desc = RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
        .setFriction(part.friction ?? 0.35)
        .setRestitution(part.restitution ?? 0.1)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min);
      // A part that names its own friction owns it: Min makes 0 mean frictionless instead of
      // averaging back up to half the marble's. Parts that stay silent keep the default average.
      if (part.friction !== undefined) desc.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
      this.physics.world.createCollider(desc, body);
    }

    const inst: TrackPieceInstance = { id: this.nextId++, placed, def, group, body, mechanisms: [] };
    group.userData.instId = inst.id;
    if (built.mechanisms) {
      const ctx = {
        world: this.physics.world,
        origin,
        quat,
        root: this.root,
        bind: (b: RAPIER.RigidBody, m: THREE.Object3D) => this.physics.bind(b, m),
        unbind: (b: RAPIER.RigidBody) => this.physics.unbind(b),
      };
      for (const make of built.mechanisms) inst.mechanisms.push(make(ctx));
    }
    if (built.spawn) inst.spawn = rotY(built.spawn, placed.rot).add(origin);
    if (built.goal) {
      const c = rotY(built.goal.center, placed.rot).add(origin);
      const h = rotY(built.goal.half, placed.rot);
      h.set(Math.abs(h.x), Math.abs(h.y), Math.abs(h.z));
      inst.goal = new THREE.Box3(c.clone().sub(h), c.clone().add(h));
    }
    this.pieces.push(inst);
    return inst;
  }

  remove(inst: TrackPieceInstance): void {
    const i = this.pieces.indexOf(inst);
    if (i < 0) return;
    this.pieces.splice(i, 1);
    for (const m of inst.mechanisms) m.dispose();
    this.root.remove(inst.group);
    inst.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.physics.world.removeRigidBody(inst.body);
  }

  clear(): void {
    for (const p of [...this.pieces]) this.remove(p);
  }

  /** Advance all mechanisms (call before each physics step). */
  update(dt: number, marbles: MarbleInfo[]): void {
    for (const inst of this.pieces) for (const m of inst.mechanisms) m.update(dt, marbles);
  }

  /** World spawn points of all start pieces, with the direction the track leaves in. */
  spawnPoints(): { pos: THREE.Vector3; dir: THREE.Vector3 }[] {
    return this.pieces
      .filter((p) => p.spawn)
      .map((p) => {
        const out = p.def.ports.find((port) => port.kind === 'out') ?? p.def.ports[0];
        return { pos: p.spawn!.clone(), dir: rotY(out.dir, p.placed.rot) };
      });
  }

  goals(): THREE.Box3[] {
    return this.pieces.filter((p) => p.goal).map((p) => p.goal!);
  }

  allPorts(): { inst: TrackPieceInstance; port: WorldPort }[] {
    return this.pieces.flatMap((inst) => worldPorts(inst.def, inst.placed).map((port) => ({ inst, port })));
  }

  /** Ports that are not connected to any other piece's port. */
  openPorts(): { inst: TrackPieceInstance; port: WorldPort }[] {
    const all = this.allPorts();
    return all.filter(
      (a) => !all.some((b) => b.inst !== a.inst && b.port.pos.distanceToSquared(a.port.pos) < 1e-4),
    );
  }

  /** Every (cell, level) slot occupied by a piece: pieces span levels [level, level + heightUnits). */
  occupiedMap(): Map<string, TrackPieceInstance> {
    const m = new Map<string, TrackPieceInstance>();
    for (const inst of this.pieces) {
      for (const key of slotKeys(inst.def, inst.placed)) m.set(key, inst);
    }
    return m;
  }

  /**
   * True if the piece can be placed: nothing of it below the ground (its anchor, its body's
   * `depthUnits` below that, and every port all at or above y = 0) and no overlap with existing
   * pieces (optionally ignoring one).
   */
  canPlace(def: PieceDef, placed: PlacedPiece, ignore?: TrackPieceInstance): boolean {
    if (placed.level - (def.depthUnits ?? 0) < 0) return false;
    if (worldPorts(def, placed).some((p) => p.pos.y < -1e-6)) return false;
    const occ = this.occupiedMap();
    return slotKeys(def, placed).every((k) => {
      const hit = occ.get(k);
      return !hit || hit === ignore;
    });
  }

  /**
   * Why this list of pieces cannot be built as a track, or null if it can. The same rules as
   * `canPlace`, but checked against the list itself, so a file can be turned away before anything
   * is loaded. Import used to skip this entirely and would happily build a track the editor would
   * never have let you draw - pieces underground at a negative level, or two in the same cell -
   * with no error and no way to tell from looking at it.
   */
  whyNotLoadable(pieces: PlacedPiece[]): string | null {
    const occ = new Map<string, number>();
    for (let i = 0; i < pieces.length; i++) {
      const placed = pieces[i];
      const def = getPiece(placed.def);
      if (!def) return `第 ${i + 1} 个零件类型未知：${String(placed.def)}`;
      const where = `第 ${i + 1} 个零件「${def.name}」`;
      if (placed.level - (def.depthUnits ?? 0) < 0) return `${where}在第 ${placed.level} 层，会伸到地面以下`;
      if (worldPorts(def, placed).some((p) => p.pos.y < -1e-6)) return `${where}的接口在地面以下`;
      for (const k of slotKeys(def, placed)) {
        const hit = occ.get(k);
        if (hit !== undefined) return `${where}和第 ${hit + 1} 个零件占了同一格`;
        occ.set(k, i);
      }
    }
    return null;
  }

  /** Find the piece instance a raycast hit belongs to. */
  instanceFromObject(obj: THREE.Object3D | null): TrackPieceInstance | null {
    let o: THREE.Object3D | null = obj;
    while (o) {
      const id = o.userData?.instId as number | undefined;
      if (id !== undefined) return this.pieces.find((p) => p.id === id) ?? null;
      o = o.parent;
    }
    return null;
  }

  toJSON(): PlacedPiece[] {
    return this.pieces.map((p) => ({ ...p.placed, cell: { ...p.placed.cell } }));
  }

  load(data: PlacedPiece[]): void {
    this.clear();
    for (const p of data) this.place(p);
  }
}

function slotKeys(def: PieceDef, placed: PlacedPiece): string[] {
  const keys: string[] = [];
  const h = Math.max(1, def.heightUnits);
  for (const c of placedCells(def, placed)) {
    for (let lv = placed.level; lv < placed.level + h; lv++) keys.push(`${c.x},${c.z},${lv}`);
  }
  return keys;
}

function portKindsCompatible(target: PortKind, candidate: PortKind): boolean {
  if (target === 'both' || candidate === 'both') return true;
  return target !== candidate; // in <-> out
}

/**
 * All placements of `def` that connect one of its ports to `target`
 * (positions coincide, directions opposite, anchor on the grid).
 */
export function snapSolutions(def: PieceDef, target: WorldPort): PlacedPiece[] {
  const wantDir = target.dir.clone().negate();
  const out: PlacedPiece[] = [];
  const seen = new Set<string>();
  for (const p of def.ports) {
    if (!portKindsCompatible(target.kind, p.kind)) continue;
    for (let rot = 0; rot < 4; rot++) {
      const d = rotY(p.dir, rot);
      if (d.distanceToSquared(wantDir) > 1e-6) continue;
      const anchor = target.pos.clone().sub(rotY(p.pos, rot));
      const cx = anchor.x / CELL;
      const cz = anchor.z / CELL;
      const lv = anchor.y / H;
      if (Math.abs(cx - Math.round(cx)) > 1e-4 || Math.abs(cz - Math.round(cz)) > 1e-4 || Math.abs(lv - Math.round(lv)) > 1e-4) continue;
      const placed: PlacedPiece = {
        def: def.id,
        cell: { x: Math.round(cx), z: Math.round(cz) },
        level: Math.round(lv),
        rot: rot as 0 | 1 | 2 | 3,
      };
      const key = `${placed.cell.x},${placed.cell.z},${placed.level},${placed.rot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(placed);
    }
  }
  return out;
}

/**
 * Given an open exit port, compute where a piece must be placed so that one of
 * its 'in'/'both' ports coincides with it (position equal, direction opposite).
 * Returns null if impossible on the grid.
 */
export function snapToPort(def: PieceDef, exit: WorldPort, preferPortIndex?: number): PlacedPiece | null {
  const wantDir = exit.dir.clone().negate();
  const candidates = def.ports
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => (p.kind === 'in' || p.kind === 'both') && (preferPortIndex === undefined || i === preferPortIndex));
  for (const { p } of candidates) {
    for (let rot = 0 as 0 | 1 | 2 | 3; rot < 4; rot = ((rot + 1) % 4) as 0 | 1 | 2 | 3) {
      const d = rotY(p.dir, rot);
      if (d.distanceToSquared(wantDir) > 1e-6) continue;
      const anchor = exit.pos.clone().sub(rotY(p.pos, rot));
      const cx = anchor.x / CELL;
      const cz = anchor.z / CELL;
      const lv = anchor.y / H;
      if (Math.abs(cx - Math.round(cx)) > 1e-4 || Math.abs(cz - Math.round(cz)) > 1e-4 || Math.abs(lv - Math.round(lv)) > 1e-4) continue;
      return { def: def.id, cell: { x: Math.round(cx), z: Math.round(cz) }, level: Math.round(lv), rot };
    }
  }
  return null;
}

/** Builds a track by chaining pieces exit -> entry. */
export class ChainBuilder {
  private exit: WorldPort | null = null;
  readonly placed: PlacedPiece[] = [];

  constructor(private track: Track) {}

  /** Place the first piece explicitly. */
  begin(placed: PlacedPiece): this {
    const inst = this.track.place(placed);
    this.placed.push(placed);
    this.exit = worldPorts(inst.def, placed).find((p) => p.kind === 'out' || p.kind === 'both') ?? null;
    return this;
  }

  /** Continue from a specific port of an already placed piece. */
  from(inst: TrackPieceInstance, portIndex: number): this {
    this.exit = worldPorts(inst.def, inst.placed)[portIndex] ?? null;
    return this;
  }

  /** Append a piece, snapping its entry to the current exit. */
  add(defId: string, opts: { entryPort?: number; exitPort?: number } = {}): this {
    if (!this.exit) throw new Error('ChainBuilder: no open exit');
    const def = getPiece(defId);
    const placed = snapToPort(def, this.exit, opts.entryPort);
    if (!placed) throw new Error(`ChainBuilder: cannot snap ${defId} to exit at ${this.exit.pos.toArray()}`);
    if (!this.track.canPlace(def, placed)) throw new Error(`ChainBuilder: ${defId} at ${JSON.stringify(placed)} overlaps or goes underground`);
    const inst = this.track.place(placed);
    this.placed.push(placed);
    const ports = worldPorts(inst.def, placed);
    // Next exit: the specified port, or the first out/both port that is not the one we just used.
    const used = ports.findIndex((p) => p.pos.distanceToSquared(this.exit!.pos) < 1e-6);
    let next: WorldPort | undefined;
    if (opts.exitPort !== undefined) next = ports[opts.exitPort];
    else next = ports.find((p, i) => i !== used && (p.kind === 'out' || p.kind === 'both'));
    this.exit = next ?? null;
    return this;
  }
}
