import * as THREE from 'three';
import { boxGeo, mergeGeometries, slopePath, sweep, troughY } from '../geometry/sweep';
import { H, v3, type BuiltPiece, type Mechanism, type MechanismContext, type PieceDef } from './types';

/** C major scale, C5..A5, one bar each along the 2-cell slope. */
const NOTES = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0];
const KEY_COLORS = [0xe0574f, 0xf2b544, 0x3ec46d, 0x3aa0ff, 0xc36bff, 0xff8a3a];

/** Hook for the audio engine; set by the game so pieces stay decoupled from it. */
export const xylophoneHooks: { play: (freq: number) => void } = { play: () => undefined };

/**
 * Xylophone: a 2-cell slope with six coloured bars set into the trough. A marble
 * rolling over each bar plays its note.
 */
export const xylophoneDef: PieceDef = {
  id: 'xylophone',
  name: '木琴道',
  footprint: [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
  ],
  heightUnits: 2,
  ports: [
    { pos: v3(-0.5, H, 0), dir: v3(-1, 0, 0), kind: 'in' },
    { pos: v3(1.5, 0, 0), dir: v3(1, 0, 0), kind: 'out' },
  ],
  build(): BuiltPiece {
    const path = slopePath(v3(-0.5, H, 0), v3(1.5, 0, 0));
    const keyXs = NOTES.map((_, i) => -0.2 + i * 0.3);
    const keys = keyXs.map((x, i) => {
      const t = (x + 0.5) / 2;
      const y = path(t).pos.y;
      // A shallow bar across the trough floor: follows the trough curve roughly with three segments.
      // 4 mm ridges: enough to tick, low enough that a slow marble still climbs over.
      const segs = [-0.2, 0, 0.2].map((z) => boxGeo(v3(x, y + troughY(z) + 0.004, z), v3(0.03, 0.004, 0.1)));
      return { geometry: mergeGeometries(segs), color: KEY_COLORS[i] };
    });
    return {
      parts: [
        { geometry: sweep(path, 24), material: 'wood' },
        // Visual only: physical ridges stall slow marbles; the notes come from the zone triggers.
        ...keys.map((k) => ({ geometry: k.geometry, material: 'accent' as const, collide: false })),
      ],
      mechanisms: [(ctx) => makeKeys(ctx, keyXs, path)],
    };
  },
};

function makeKeys(ctx: MechanismContext, keyXs: number[], path: (t: number) => { pos: THREE.Vector3 }): Mechanism {
  const inv = ctx.quat.clone().invert();
  const local = new THREE.Vector3();
  const lastX = new Map<number, number>();
  // Per-key mesh colours (the shared 'accent' material is red): recolour our key meshes in the piece group.
  let recoloured = false;
  return {
    update(_dt, marbles) {
      if (!recoloured) {
        recoloured = true;
        // Find the key meshes just added to the piece group: they are the parts after the trough sweep.
        const group = ctx.root.children.find((c) => c instanceof THREE.Group && c.position.equals(ctx.origin) && c.quaternion.equals(ctx.quat)) as THREE.Group | undefined;
        if (group) {
          const meshes = group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
          meshes.slice(1).forEach((m, i) => {
            if (i < KEY_COLORS.length) m.material = new THREE.MeshStandardMaterial({ color: KEY_COLORS[i], roughness: 0.6 });
          });
        }
      }
      for (const m of marbles) {
        local.copy(m.pos).sub(ctx.origin).applyQuaternion(inv);
        const prev = lastX.get(m.id);
        if (Math.abs(local.z) < 0.4 && local.x > -0.6 && local.x < 1.6 && local.y > -0.2 && local.y < 0.8) {
          if (prev !== undefined) {
            keyXs.forEach((kx, i) => {
              if ((prev < kx && local.x >= kx) || (prev > kx && local.x <= kx)) {
                const t = (kx + 0.5) / 2;
                if (Math.abs(local.y - path(t).pos.y - 0.15) < 0.15) xylophoneHooks.play(NOTES[i]);
              }
            });
          }
          lastX.set(m.id, local.x);
        } else {
          lastX.delete(m.id);
        }
      }
    },
    dispose() {
      lastX.clear();
    },
  };
}
