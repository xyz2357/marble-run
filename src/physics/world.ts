import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export const FIXED_DT = 1 / 120;
const MAX_SUBSTEPS = 8;

export interface BodyBinding {
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
}

/** Thin wrapper around a Rapier world with a fixed-step accumulator and mesh sync. */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private accumulator = 0;
  private bindings: BodyBinding[] = [];
  private debugLines: THREE.LineSegments | null = null;
  stepCount = 0;

  constructor(gravity = { x: 0, y: -9.81, z: 0 }) {
    this.world = new RAPIER.World(gravity);
    this.world.timestep = FIXED_DT;
  }

  bind(body: RAPIER.RigidBody, mesh: THREE.Object3D): void {
    this.bindings.push({ body, mesh });
  }

  unbind(body: RAPIER.RigidBody): void {
    this.bindings = this.bindings.filter((b) => b.body !== body);
  }

  /** Advance simulation by real elapsed seconds, in fixed sub-steps. */
  update(dtSeconds: number): void {
    this.accumulator += Math.min(dtSeconds, 0.25);
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.world.step();
      this.stepCount++;
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this.accumulator = 0; // drop time if we fall behind
    this.syncMeshes();
  }

  /** One fixed step without syncing meshes (the caller syncs once per frame). */
  stepOnce(): void {
    this.world.step();
    this.stepCount++;
  }

  /** Step exactly n fixed steps (used by tests). */
  stepN(n: number): void {
    for (let i = 0; i < n; i++) this.stepOnce();
    this.syncMeshes();
  }

  syncMeshes(): void {
    for (const { body, mesh } of this.bindings) {
      const t = body.translation();
      const r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Toggle wireframe rendering of all colliders. */
  setDebug(scene: THREE.Scene, enabled: boolean): void {
    if (enabled && !this.debugLines) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineBasicMaterial({ vertexColors: true });
      this.debugLines = new THREE.LineSegments(geo, mat);
      this.debugLines.frustumCulled = false;
      scene.add(this.debugLines);
    } else if (!enabled && this.debugLines) {
      scene.remove(this.debugLines);
      this.debugLines.geometry.dispose();
      this.debugLines = null;
    }
  }

  updateDebug(): void {
    if (!this.debugLines) return;
    const buffers = this.world.debugRender();
    const geo = this.debugLines.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(buffers.vertices, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 4));
  }

  get debugEnabled(): boolean {
    return this.debugLines !== null;
  }
}
