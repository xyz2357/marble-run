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
  type MaterialKey,
  type PieceDef,
  type PlacedPiece,
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
}

export const MATERIALS: Record<MaterialKey, THREE.Material> = {
  wood: new THREE.MeshStandardMaterial({ color: 0xd2a56d, roughness: 0.85, side: THREE.DoubleSide, flatShading: true }),
  dark: new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9, side: THREE.DoubleSide, flatShading: true }),
  accent: new THREE.MeshStandardMaterial({ color: 0xe0574f, roughness: 0.7, side: THREE.DoubleSide }),
  goal: new THREE.MeshStandardMaterial({ color: 0x3ec46d, roughness: 0.7, side: THREE.DoubleSide }),
};

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
      const mesh = new THREE.Mesh(part.geometry, MATERIALS[part.material]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
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
        .setFriction(0.5)
        .setRestitution(0.1)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min);
      this.physics.world.createCollider(desc, body);
    }

    const inst: TrackPieceInstance = { id: this.nextId++, placed, def, group, body };
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
    this.root.remove(inst.group);
    inst.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.physics.world.removeRigidBody(inst.body);
  }

  clear(): void {
    for (const p of [...this.pieces]) this.remove(p);
  }

  spawnPoints(): THREE.Vector3[] {
    return this.pieces.filter((p) => p.spawn).map((p) => p.spawn!.clone());
  }

  goals(): THREE.Box3[] {
    return this.pieces.filter((p) => p.goal).map((p) => p.goal!);
  }

  allPorts(): { inst: TrackPieceInstance; port: WorldPort }[] {
    return this.pieces.flatMap((inst) => worldPorts(inst.def, inst.placed).map((port) => ({ inst, port })));
  }

  /** Cells currently occupied at a given level range (approximate: any level). */
  occupied(): Set<string> {
    const s = new Set<string>();
    for (const inst of this.pieces) {
      for (const c of placedCells(inst.def, inst.placed)) s.add(`${c.x},${c.z},${inst.placed.level}`);
    }
    return s;
  }

  toJSON(): PlacedPiece[] {
    return this.pieces.map((p) => ({ ...p.placed, cell: { ...p.placed.cell } }));
  }

  load(data: PlacedPiece[]): void {
    this.clear();
    for (const p of data) this.place(p);
  }
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

  /** Append a piece, snapping its entry to the current exit. */
  add(defId: string, opts: { entryPort?: number; exitPort?: number } = {}): this {
    if (!this.exit) throw new Error('ChainBuilder: no open exit');
    const def = getPiece(defId);
    const placed = snapToPort(def, this.exit, opts.entryPort);
    if (!placed) throw new Error(`ChainBuilder: cannot snap ${defId} to exit at ${this.exit.pos.toArray()}`);
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
