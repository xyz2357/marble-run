import * as THREE from 'three';

/** Horizontal grid cell size (meters). */
export const CELL = 1.0;
/** Vertical level unit (meters). Piece heights and port heights are multiples of this. */
export const H = 0.5;

export type PortKind = 'in' | 'out' | 'both';

export interface PortDef {
  /** Local position (meters), at a cell-edge midpoint, y a multiple of H. */
  pos: THREE.Vector3;
  /** Local outward direction (unit, axis-aligned, horizontal). */
  dir: THREE.Vector3;
  kind: PortKind;
}

export type MaterialKey = 'wood' | 'dark' | 'accent' | 'goal';

export interface MeshPart {
  /**
   * Indexed geometry with OUTWARD-facing triangle winding. The same mesh is used as a Rapier
   * trimesh collider with FIX_INTERNAL_EDGES, which is orientation sensitive: a marble touching
   * a back face can pass straight through it (see the funnel lathe profile for an example).
   */
  geometry: THREE.BufferGeometry;
  material: MaterialKey;
  /** false => visual only, no collider */
  collide?: boolean;
}

/** What a mechanism factory gets to work with. */
export interface MechanismContext {
  world: import('@dimforge/rapier3d-compat').World;
  /** Piece origin / rotation in world space. */
  origin: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Scene group to add world-space meshes to. */
  root: THREE.Object3D;
  /** Register a body whose mesh must follow it. */
  bind: (body: import('@dimforge/rapier3d-compat').RigidBody, mesh: THREE.Object3D) => void;
  unbind: (body: import('@dimforge/rapier3d-compat').RigidBody) => void;
}

export interface MarbleInfo {
  id: number;
  pos: THREE.Vector3;
}

/** A moving part of a piece: kinematic / dynamic bodies plus per-step logic. */
export interface Mechanism {
  /** Called before every physics step. */
  update(dt: number, marbles: MarbleInfo[]): void;
  dispose(): void;
}

export interface BuiltPiece {
  parts: MeshPart[];
  /** Visual-only parts shown in previews (ghost / thumbnails) for moving pieces. */
  preview?: MeshPart[];
  /** Local marble spawn point (start pieces). */
  spawn?: THREE.Vector3;
  /** Local AABB that counts as "finished" (end pieces). */
  goal?: { center: THREE.Vector3; half: THREE.Vector3 };
  /** Factories for moving parts, created when the piece is placed. */
  mechanisms?: ((ctx: MechanismContext) => Mechanism)[];
}

export interface PieceDef {
  id: string;
  name: string;
  /** Cells occupied, relative to the anchor cell (0,0). */
  footprint: { x: number; z: number }[];
  /** Vertical extent in H units above the anchor level (informational). */
  heightUnits: number;
  ports: PortDef[];
  build(): BuiltPiece;
}

export interface PlacedPiece {
  def: string;
  cell: { x: number; z: number };
  level: number; // in H units
  rot: 0 | 1 | 2 | 3; // multiples of 90deg about +Y
}

export function v3(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

/** Rotate a local vector by rot*90deg about +Y. rot=1 maps +X to -Z, rot=3 maps +X to +Z. */
export function rotY(v: THREE.Vector3, rot: number): THREE.Vector3 {
  const r = ((rot % 4) + 4) % 4;
  const { x, y, z } = v;
  switch (r) {
    case 0:
      return new THREE.Vector3(x, y, z);
    case 1:
      return new THREE.Vector3(z, y, -x);
    case 2:
      return new THREE.Vector3(-x, y, -z);
    default:
      return new THREE.Vector3(-z, y, x);
  }
}

export function placedOrigin(p: PlacedPiece): THREE.Vector3 {
  return new THREE.Vector3(p.cell.x * CELL, p.level * H, p.cell.z * CELL);
}

export function placedQuat(p: PlacedPiece): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (p.rot * Math.PI) / 2);
}

export interface WorldPort {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  kind: PortKind;
}

export function worldPorts(def: PieceDef, p: PlacedPiece): WorldPort[] {
  const o = placedOrigin(p);
  return def.ports.map((port) => ({
    pos: rotY(port.pos, p.rot).add(o),
    dir: rotY(port.dir, p.rot),
    kind: port.kind,
  }));
}

/** World cells occupied by a placed piece. */
export function placedCells(def: PieceDef, p: PlacedPiece): { x: number; z: number }[] {
  return def.footprint.map((c) => {
    const r = rotY(new THREE.Vector3(c.x, 0, c.z), p.rot);
    return { x: Math.round(r.x) + p.cell.x, z: Math.round(r.z) + p.cell.z };
  });
}
