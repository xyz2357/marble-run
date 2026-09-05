import * as THREE from 'three';
import type { Editor, Mode, ToolMode } from './editor/editor';
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
    stepN: (n: number) => game.step(n),
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
    results: () => game.results.map((r) => ({ ...r })),
    simTime: () => game.simTime,
    spawnBurst: (n: number) => game.spawnBurst(n),
    setAutoSpawn: (on: boolean) => game.setAutoSpawn(on),
    setTimeScale: (s: number) => game.setTimeScale(s),
    timeScale: () => game.timeScale,
    setFollow: (on: boolean) => game.setFollow(on),
    follow: () => game.follow,
    leader: () => {
      const m = game.leader();
      if (!m) return null;
      const t = m.body.translation();
      return { id: m.id, x: t.x, y: t.y, z: t.z };
    },
    audioStats: () => ({ available: game.audio.available, state: game.audio.state, muted: game.audio.muted, impacts: game.audio.impactCount, detected: game.audio.impactsDetected }),
    /** Run realtime frames for a while (lets follow-camera / audio code run); resolves after ms. */
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
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
    setToolMode: (m: ToolMode) => editor.setToolMode(m),
    toolMode: () => editor.toolMode,
    activePort: () => (editor.activePort ? { x: editor.activePort.pos.x, y: editor.activePort.pos.y, z: editor.activePort.pos.z, kind: editor.activePort.kind } : null),
    /** Pick a placed piece by index in pieces(); null clears. */
    pick: (index: number | null) => editor.pick(index === null ? null : game.track.pieces[index] ?? null),
    picked: () => (editor.picked ? { ...editor.picked.placed, cell: { ...editor.picked.placed.cell } } : null),
    rotatePicked: () => editor.rotatePicked(),
    movePicked: (dx: number, dl: number, dz: number) => editor.movePicked(dx, dl, dz),
    deletePicked: () => editor.deletePicked(),
    cameraTarget: () => ({ x: game.controls.target.x, y: game.controls.target.y, z: game.controls.target.z }),
    cameraPos: () => ({ x: game.camera.position.x, y: game.camera.position.y, z: game.camera.position.z }),
    select: (id: string | null) => editor.select(id),
    setLevel: (n: number) => editor.setLevel(n),
    rotate: () => editor.rotate(),
    place: () => editor.place()?.id ?? null,
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    clearTrack: () => editor.clear(),
    candidate: () => {
      editor.updateCandidate();
      return editor.candidate ? { ...editor.candidate, placed: { ...editor.candidate.placed } } : null;
    },
    editorState: () => ({ mode: editor.mode, selected: editor.selectedDef?.id ?? null, level: editor.level, rot: editor.rot, canUndo: editor.canUndo, canRedo: editor.canRedo }),
    exportJSON: () => editor.exportJSON(),
    importJSON: (text: string) => editor.importJSON(text),
  };
  (window as unknown as { __TEST__: typeof seam }).__TEST__ = seam;
}
