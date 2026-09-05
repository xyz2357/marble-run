import * as THREE from 'three';
import { placedOrigin, placedQuat, type PieceDef, type PlacedPiece } from '../pieces/types';

const VALID = 0x4ade80;
const INVALID = 0xf87171;
const CLOSES = 0x38bdf8;

/** Translucent preview of the piece about to be placed. */
export class Ghost {
  readonly group = new THREE.Group();
  private defId: string | null = null;
  private materials: THREE.MeshStandardMaterial[] = [];

  constructor(scene: THREE.Scene) {
    this.group.visible = false;
    this.group.renderOrder = 10;
    scene.add(this.group);
  }

  setDef(def: PieceDef): void {
    if (def.id === this.defId) return;
    this.defId = def.id;
    this.disposeChildren();
    const built = def.build();
    for (const part of built.parts) {
      const mat = new THREE.MeshStandardMaterial({
        color: VALID,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
        roughness: 0.6,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(part.geometry, mat);
      this.group.add(mesh);
    }
  }

  setPlacement(p: PlacedPiece): void {
    this.group.position.copy(placedOrigin(p));
    this.group.quaternion.copy(placedQuat(p));
  }

  setValid(valid: boolean, closes = false): void {
    const c = !valid ? INVALID : closes ? CLOSES : VALID;
    for (const m of this.materials) m.color.set(c);
  }

  show(): void {
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  private disposeChildren(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
    for (const m of this.materials) m.dispose();
    this.materials = [];
  }
}
