import * as THREE from 'three';
import type { Editor, Mode } from './editor/editor';
import type { Game } from './game/game';
import type { PlacedPiece } from './pieces/types';

/** Exposed on window.__TEST__ so Playwright can drive the game deterministically. */
export function installTestSeam(game: Game, editor: Editor): void {
  const seam = {
    ready: true,
    // --- simulation
    /** Pause the realtime loop; tests then drive with stepN. */
    pause: () => game.setPaused(true),
    resume: () => game.setPaused(false),
    stepN: (n: number) => {
      game.physics.stepN(n);
      game.checkGoals();
    },
    stepCount: () => game.physics.stepCount,
    setDebug: (on: boolean) => game.setDebug(on),
    // --- marbles
    spawnMarble: (x: number, y: number, z: number) => game.spawnMarble({ x, y, z }).id,
    spawnAtStart: () => game.spawnAtStart().map((m) => m.id),
    clearMarbles: () => game.clearMarbles(),
    marbles: () =>
      game.marbles.map((m) => {
        const t = m.body.translation();
        const v = m.body.linvel();
        return { id: m.id, x: t.x, y: t.y, z: t.z, vx: v.x, vy: v.y, vz: v.z };
      }),
    finished: () => [...game.finished],
    // --- track
    pieces: () => game.track.toJSON(),
    ports: () =>
      game.track.allPorts().map(({ inst, port }) => ({
        piece: inst.placed.def,
        x: port.pos.x,
        y: port.pos.y,
        z: port.pos.z,
        dx: port.dir.x,
        dz: port.dir.z,
        kind: port.kind,
      })),
    /** Open (unconnected) ports with their screen-pixel positions. */
    openPortsScreen: () =>
      game.track.openPorts().map(({ inst, port }) => {
        const s = editor.projectToPx(port.pos);
        return { piece: inst.placed.def, kind: port.kind, x: s.x, y: s.y, wx: port.pos.x, wy: port.pos.y, wz: port.pos.z };
      }),
    /** Screen-pixel position of a placed piece's center (by index in pieces()). */
    pieceScreenPos: (index: number) => {
      const inst = game.track.pieces[index];
      if (!inst) return null;
      const box = new THREE.Box3().setFromObject(inst.group);
      return editor.projectToPx(box.getCenter(new THREE.Vector3()));
    },
    loadTrack: (data: PlacedPiece[]) => {
      game.clearMarbles();
      game.track.load(data);
      game.frameTrack();
    },
    loadDemo: () => editor.loadDemo(),
    frameTrack: () => game.frameTrack(),
    lookAt: (x: number, y: number, z: number, dist: number) => {
      game.controls.target.set(x, y, z);
      game.camera.position.set(x + dist * 0.7, y + dist * 0.6, z + dist);
      game.controls.update();
    },
    // --- editor
    setMode: (m: Mode) => editor.setMode(m),
    mode: () => editor.mode,
    select: (id: string | null) => editor.select(id),
    setLevel: (n: number) => editor.setLevel(n),
    rotate: () => editor.rotate(),
    place: () => editor.place()?.id ?? null,
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    clearTrack: () => editor.clear(),
    candidate: () => {
      editor.update();
      return editor.candidate ? { ...editor.candidate, placed: { ...editor.candidate.placed } } : null;
    },
    editorState: () => ({ mode: editor.mode, selected: editor.selectedDef?.id ?? null, level: editor.level, rot: editor.rot, canUndo: editor.canUndo, canRedo: editor.canRedo }),
    exportJSON: () => editor.exportJSON(),
    importJSON: (text: string) => editor.importJSON(text),
  };
  (window as unknown as { __TEST__: typeof seam }).__TEST__ = seam;
}
