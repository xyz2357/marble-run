import * as THREE from 'three';
import type { Game } from '../game/game';
import { DEMOS } from '../game/demo';
import { snapSolutions, type TrackPieceInstance } from '../game/track';
import { getPiece, paletteDefs, PIECES, variantsOf } from '../pieces/registry';
import { CELL, H, worldPorts, type PieceDef, type PlacedPiece, type WorldPort } from '../pieces/types';
import { Ghost } from './ghost';

export type Mode = 'edit' | 'play';
/** chain: new pieces attach to the active port; free: mouse-driven placement with snapping. */
export type ToolMode = 'chain' | 'free';

export const AUTOSAVE_KEY = 'marble-run.autosave.v1';
/** Keyboard shortcuts for the palette, in paletteDefs() order. */
export const PIECE_KEYS = '1234567890-=';
const SNAP_PX = 48;
const PORT_CLICK_PX = 28;
const CLICK_PX = 8;
const MAX_UNDO = 100;
const MIN_LEVEL = 0;
const MAX_LEVEL = 40;
const PAN_STEP = 1.0;

export interface Candidate {
  placed: PlacedPiece;
  valid: boolean;
  snapped: boolean;
  /** Number of alternative snap solutions at this port (R cycles through them). */
  alternatives: number;
  /** True when another port of the candidate also lands on an existing open port (a gap is closed). */
  closes: boolean;
}

export interface SaveFile {
  version: 1;
  pieces: PlacedPiece[];
}

/**
 * Track editor: palette selection, ghost preview, chain/free placement,
 * selection editing (rotate / move / delete), undo/redo, autosave, camera helpers.
 */
export class Editor {
  mode: Mode = 'edit';
  toolMode: ToolMode = 'chain';
  selectedDef: PieceDef | null = null;
  /** Level used for free (non-snapped) placement. */
  level = 4;
  /** Rotation used for free placement. */
  rot: 0 | 1 | 2 | 3 = 0;
  /** Which snap solution to use when several exist. */
  snapIndex = 0;
  candidate: Candidate | null = null;
  hovered: TrackPieceInstance | null = null;
  picked: TrackPieceInstance | null = null;
  /** Chain mode: the port the next piece attaches to. */
  activePort: WorldPort | null = null;
  /** Chain mode: are we extending forwards (from exits) or backwards (from entries)? Kept across 'both' ports. */
  chainDir: 'forward' | 'backward' = 'forward';
  /** Why there is no candidate (shown in the HUD). */
  candidateMessage = '';
  /** UI refresh callback. */
  onChange: (() => void) | null = null;

  private ghost: Ghost;
  private highlight: THREE.BoxHelper;
  private portMarkers = new THREE.Group();
  private portMarkerGeo = new THREE.SphereGeometry(0.1, 12, 8);
  private portMarkerMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthTest: false });
  private activeMarker: THREE.Mesh;
  private portMarkersDirty = true;
  private guide: THREE.Line;
  private guideFoot: THREE.Mesh;
  private pointerPx = { x: -1, y: -1 };
  private pointerInside = false;
  private raycaster = new THREE.Raycaster();
  private downPos: { x: number; y: number; button: number } | null = null;
  private undoStack: PlacedPiece[][] = [];
  private redoStack: PlacedPiece[][] = [];
  private pickedPanel: HTMLElement | null = null;

  constructor(private game: Game) {
    this.ghost = new Ghost(game.scene);
    this.highlight = new THREE.BoxHelper(new THREE.Object3D(), 0xffd166);
    this.highlight.visible = false;
    game.scene.add(this.highlight);
    this.portMarkers.renderOrder = 20;
    game.scene.add(this.portMarkers);
    this.activeMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.activeMarker.renderOrder = 21;
    this.activeMarker.visible = false;
    game.scene.add(this.activeMarker);

    const guideGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]);
    this.guide = new THREE.Line(guideGeo, new THREE.LineDashedMaterial({ color: 0x4ade80, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.8 }));
    this.guide.visible = false;
    game.scene.add(this.guide);
    this.guideFoot = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.32, 24),
      new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    this.guideFoot.rotation.x = -Math.PI / 2;
    this.guideFoot.visible = false;
    game.scene.add(this.guideFoot);

    const el = game.renderer.domElement;
    el.addEventListener('pointermove', (e) => {
      this.pointerPx = { x: e.clientX, y: e.clientY };
      this.pointerInside = true;
    });
    el.addEventListener('pointerleave', () => {
      this.pointerInside = false;
    });
    el.addEventListener('pointerdown', (e) => {
      this.downPos = { x: e.clientX, y: e.clientY, button: e.button };
    });
    el.addEventListener('pointerup', (e) => {
      const d = this.downPos;
      this.downPos = null;
      if (!d || d.button !== e.button) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) return;
      this.pointerPx = { x: e.clientX, y: e.clientY };
      this.pointerInside = true;
      this.click(e.button);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        if (!e.shiftKey || this.mode !== 'edit') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.setLevel(this.level + (e.deltaY < 0 ? 1 : -1));
      },
      { capture: true, passive: false },
    );
    window.addEventListener('keydown', (e) => this.onKey(e));

    game.beforeRender = () => this.update();
  }

  // ---------------------------------------------------------------- mode

  setMode(mode: Mode): void {
    this.mode = mode;
    this.game.clearMarbles();
    if (mode === 'play') {
      this.ghost.hide();
      this.highlight.visible = false;
      this.picked = null;
      this.game.setPaused(false);
      this.game.spawnAtStart();
    } else {
      this.game.setPaused(true);
    }
    this.changed();
  }

  setToolMode(tm: ToolMode): void {
    this.toolMode = tm;
    this.snapIndex = 0;
    if (tm === 'chain' && !this.activePort) this.resolveActivePort(null);
    this.changed();
  }

  // ---------------------------------------------------------------- tool state

  select(defId: string | null): void {
    this.selectedDef = defId ? getPiece(defId) : null;
    this.snapIndex = 0;
    this.picked = null;
    this.changed();
  }

  selectByIndex(i: number): void {
    const defs = paletteDefs();
    if (i >= 0 && i < defs.length) this.select(this.selectedDef?.id === defs[i].id ? null : defs[i].id);
  }

  /** The piece whose family variants the UI offers: the picked piece, else the one being placed. */
  get variantContext(): PieceDef | null {
    return this.picked?.def ?? this.selectedDef;
  }

  /**
   * Switch to another member of the current family: swaps the picked piece in place (if the
   * new size fits), or changes the piece being placed.
   */
  setVariant(defId: string): boolean {
    const def = getPiece(defId);
    if (this.picked) {
      if (this.mode !== 'edit') return false;
      if (this.picked.def.id === defId) return true;
      const next: PlacedPiece = { ...this.picked.placed, cell: { ...this.picked.placed.cell }, def: defId };
      if (!this.game.track.canPlace(def, next, this.picked)) return false;
      this.replacePiece(this.picked, next);
      return true;
    }
    if (this.selectedDef) {
      this.selectedDef = def;
      this.snapIndex = 0;
      this.changed();
      return true;
    }
    return false;
  }

  /** V key: next member of the current family (wraps). */
  cycleVariant(dir = 1): boolean {
    const ctx = this.variantContext;
    if (!ctx) return false;
    const vs = variantsOf(ctx);
    if (vs.length < 2) return false;
    const i = vs.findIndex((d) => d.id === ctx.id);
    for (let k = 1; k < vs.length; k++) {
      const next = vs[(((i + dir * k) % vs.length) + vs.length) % vs.length];
      if (this.setVariant(next.id)) return true;
    }
    return false;
  }

  setLevel(level: number): void {
    this.level = THREE.MathUtils.clamp(Math.round(level), MIN_LEVEL, MAX_LEVEL);
    this.changed();
  }

  /** R key: cycle snap alternatives when snapped, otherwise rotate the free placement. */
  rotate(): void {
    if (this.candidate?.snapped && this.candidate.alternatives > 1) {
      this.snapIndex = (this.snapIndex + 1) % this.candidate.alternatives;
    } else {
      this.rot = ((this.rot + 1) % 4) as 0 | 1 | 2 | 3;
    }
    this.changed();
  }

  /** Make a port the chain-mode attachment point. */
  setActivePort(port: WorldPort | null): void {
    this.activePort = port ? { pos: port.pos.clone(), dir: port.dir.clone(), kind: port.kind } : null;
    if (port?.kind === 'in') this.chainDir = 'backward';
    else if (port?.kind === 'out') this.chainDir = 'forward';
    this.snapIndex = 0;
    this.changed();
  }

  // ---------------------------------------------------------------- selection editing

  /** Select an existing piece for editing. Picking drops the placement tool: you either place or edit. */
  pick(inst: TrackPieceInstance | null): void {
    this.picked = inst;
    if (inst) this.selectedDef = null;
    this.changed();
  }

  /**
   * Rotate the picked piece. If it is connected to a neighbour, cycle through the
   * other ways of attaching to that neighbour; otherwise rotate in place.
   */
  rotatePicked(): boolean {
    const inst = this.picked;
    if (!inst) return false;
    const cur = inst.placed;
    let options: PlacedPiece[] = [];
    const neighbour = this.connectedNeighbourPort(inst);
    if (neighbour) {
      options = snapSolutions(inst.def, neighbour);
    } else {
      for (let k = 1; k <= 3; k++) options.push({ ...cur, cell: { ...cur.cell }, rot: ((cur.rot + k) % 4) as 0 | 1 | 2 | 3 });
    }
    const same = (a: PlacedPiece, b: PlacedPiece) => a.cell.x === b.cell.x && a.cell.z === b.cell.z && a.level === b.level && a.rot === b.rot;
    const idx = options.findIndex((o) => same(o, cur));
    for (let k = 1; k <= options.length; k++) {
      const next = options[(idx + k) % options.length];
      if (same(next, cur)) continue;
      if (!this.game.track.canPlace(inst.def, next, inst)) continue;
      this.replacePiece(inst, next);
      return true;
    }
    return false;
  }

  /** Move the picked piece up/down by whole levels (free mode). */
  movePicked(dx: number, dLevel: number, dz: number): boolean {
    const inst = this.picked;
    if (!inst) return false;
    const next: PlacedPiece = {
      ...inst.placed,
      cell: { x: inst.placed.cell.x + dx, z: inst.placed.cell.z + dz },
      level: THREE.MathUtils.clamp(inst.placed.level + dLevel, MIN_LEVEL, MAX_LEVEL),
    };
    if (!this.game.track.canPlace(inst.def, next, inst)) return false;
    this.replacePiece(inst, next);
    return true;
  }

  deletePicked(): void {
    if (this.picked) this.deletePiece(this.picked);
  }

  private replacePiece(inst: TrackPieceInstance, next: PlacedPiece): void {
    this.pushUndo();
    this.game.track.remove(inst);
    const created = this.game.track.place(next);
    this.picked = created;
    this.afterMutation();
  }

  /** The other piece's port that `inst` is connected to (first found), or null. */
  private connectedNeighbourPort(inst: TrackPieceInstance): WorldPort | null {
    const mine = worldPorts(inst.def, inst.placed);
    for (const { inst: other, port } of this.game.track.allPorts()) {
      if (other === inst) continue;
      if (mine.some((p) => p.pos.distanceToSquared(port.pos) < 1e-4)) return port;
    }
    return null;
  }

  // ---------------------------------------------------------------- mutations

  /** Place the current candidate if valid. Returns the new instance or null. */
  place(): TrackPieceInstance | null {
    if (this.mode !== 'edit') return null;
    this.updateCandidate();
    if (!this.candidate?.valid) return null;
    this.pushUndo();
    const inst = this.game.track.place(this.candidate.placed);
    this.snapIndex = 0;
    this.afterMutation(inst);
    return inst;
  }

  deletePiece(inst: TrackPieceInstance): void {
    if (this.mode !== 'edit') return;
    this.pushUndo();
    this.game.track.remove(inst);
    if (this.picked === inst) this.picked = null;
    if (this.hovered === inst) this.hovered = null;
    this.afterMutation();
  }

  clear(): void {
    if (this.game.track.pieces.length === 0) return;
    this.pushUndo();
    this.game.track.clear();
    this.picked = null;
    this.hovered = null;
    this.afterMutation();
  }

  /** Load a preset track by its 1-based index in DEMOS. */
  loadDemo(which = 1): void {
    const demo = DEMOS[which - 1] ?? DEMOS[0];
    this.pushUndo();
    this.game.track.clear();
    demo.build(this.game.track);
    this.game.frameTrack();
    this.afterMutation();
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.game.track.toJSON());
    this.game.track.load(prev);
    this.picked = null;
    this.hovered = null;
    this.afterMutation();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.game.track.toJSON());
    this.game.track.load(next);
    this.picked = null;
    this.hovered = null;
    this.afterMutation();
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private pushUndo(): void {
    this.undoStack.push(this.game.track.toJSON());
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private afterMutation(justPlaced: TrackPieceInstance | null = null): void {
    this.autosave();
    this.portMarkersDirty = true;
    this.resolveActivePort(justPlaced);
    this.changed();
  }

  /**
   * Keep the active port pointing at an open port after the track changed:
   * prefer the exit of a just-placed piece, else the same position as before,
   * else the last piece's exit, else nothing.
   */
  private resolveActivePort(justPlaced: TrackPieceInstance | null): void {
    const open = this.game.track.openPorts();
    // Building backwards (from entries) continues from the new piece's entry; forwards from its exit.
    if (this.activePort?.kind === 'in') this.chainDir = 'backward';
    else if (this.activePort?.kind === 'out') this.chainDir = 'forward';
    const primary = this.chainDir === 'backward' ? 'in' : 'out';
    const exitOf = (inst: TrackPieceInstance): WorldPort | null => {
      const mine = open.filter((o) => o.inst === inst).map((o) => o.port);
      return mine.find((p) => p.kind === primary) ?? mine.find((p) => p.kind === 'both') ?? null;
    };
    let next: WorldPort | null = null;
    if (justPlaced) next = exitOf(justPlaced);
    if (!next && this.activePort) {
      const same = open.find((o) => o.port.pos.distanceToSquared(this.activePort!.pos) < 1e-4);
      if (same) next = same.port;
    }
    if (!next) {
      // Continuity lost (new track, deleted piece): default to building forwards from the last exit.
      this.chainDir = 'forward';
      const pieces = this.game.track.pieces;
      const lastExit = (inst: TrackPieceInstance): WorldPort | null => {
        const mine = open.filter((o) => o.inst === inst).map((o) => o.port);
        return mine.find((p) => p.kind === 'out') ?? mine.find((p) => p.kind === 'both') ?? null;
      };
      for (let i = pieces.length - 1; i >= 0 && !next; i--) next = lastExit(pieces[i]);
    }
    if (!next) next = (open.find((o) => o.port.kind !== 'in') ?? open[0])?.port ?? null;
    this.activePort = next ? { pos: next.pos.clone(), dir: next.dir.clone(), kind: next.kind } : null;
    if (next?.kind === 'in') this.chainDir = 'backward';
    else if (next?.kind === 'out') this.chainDir = 'forward';
  }

  private refreshPortMarkers(): void {
    if (!this.portMarkersDirty) return;
    this.portMarkersDirty = false;
    for (const c of [...this.portMarkers.children]) this.portMarkers.remove(c);
    for (const { port } of this.game.track.openPorts()) {
      const m = new THREE.Mesh(this.portMarkerGeo, this.portMarkerMat);
      m.position.copy(port.pos).add(new THREE.Vector3(0, 0.15, 0));
      this.portMarkers.add(m);
    }
  }

  // ---------------------------------------------------------------- persistence

  exportJSON(): string {
    const file: SaveFile = { version: 1, pieces: this.game.track.toJSON() };
    return JSON.stringify(file, null, 2);
  }

  /** Parse and load a save file. Throws on invalid input. */
  importJSON(text: string): void {
    const data = JSON.parse(text) as Partial<SaveFile>;
    if (!data || !Array.isArray(data.pieces)) throw new Error('无效的存档：缺少 pieces');
    const pieces: PlacedPiece[] = data.pieces.map((p, i) => {
      if (!p || typeof p !== 'object' || !PIECES.has(p.def)) throw new Error(`第 ${i + 1} 个零件类型未知: ${String(p?.def)}`);
      return {
        def: p.def,
        cell: { x: Math.round(Number(p.cell?.x) || 0), z: Math.round(Number(p.cell?.z) || 0) },
        level: Math.round(Number(p.level) || 0),
        rot: (((Math.round(Number(p.rot) || 0) % 4) + 4) % 4) as 0 | 1 | 2 | 3,
      };
    });
    this.pushUndo();
    this.game.track.load(pieces);
    this.game.frameTrack();
    this.afterMutation();
  }

  download(): void {
    const blob = new Blob([this.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marble-track-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  autosave(): void {
    try {
      localStorage.setItem(AUTOSAVE_KEY, this.exportJSON());
    } catch {
      /* storage unavailable: ignore */
    }
  }

  /** Load the autosaved track, if any. Returns whether something was loaded. */
  loadAutosave(): boolean {
    try {
      const text = localStorage.getItem(AUTOSAVE_KEY);
      if (!text) return false;
      const data = JSON.parse(text) as SaveFile;
      if (!Array.isArray(data.pieces) || data.pieces.length === 0) return false;
      this.game.track.load(data.pieces.filter((p) => PIECES.has(p.def)));
      this.resolveActivePort(null);
      return this.game.track.pieces.length > 0;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- camera

  /** Pan the camera and its target along the ground plane, relative to the view direction. */
  pan(right: number, forward: number): void {
    const cam = this.game.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const rgt = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const delta = rgt.multiplyScalar(right * PAN_STEP).add(fwd.multiplyScalar(forward * PAN_STEP));
    cam.position.add(delta);
    this.game.controls.target.add(delta);
    this.game.controls.update();
  }

  /** Preset views around the current orbit target. */
  setView(view: 'top' | 'iso' | 'side'): void {
    const c = this.game.controls;
    const dist = Math.max(4, c.getDistance());
    const t = c.target.clone();
    const dir = view === 'top' ? new THREE.Vector3(0, 1, 0.001) : view === 'side' ? new THREE.Vector3(0, 0.25, 1) : new THREE.Vector3(0.7, 0.6, 1);
    this.game.camera.position.copy(t).add(dir.normalize().multiplyScalar(dist));
    c.update();
  }

  /** Move the orbit target to the picked piece or the active port, keeping the viewing distance. */
  focus(): void {
    let target: THREE.Vector3 | null = null;
    if (this.picked) target = new THREE.Box3().setFromObject(this.picked.group).getCenter(new THREE.Vector3());
    else if (this.activePort) target = this.activePort.pos.clone();
    if (!target) return this.game.frameTrack();
    const c = this.game.controls;
    const offset = this.game.camera.position.clone().sub(c.target);
    const dist = Math.min(offset.length(), 8);
    c.target.copy(target);
    this.game.camera.position.copy(target).add(offset.normalize().multiplyScalar(dist));
    c.update();
  }

  // ---------------------------------------------------------------- input

  private click(button: number): void {
    if (this.mode !== 'edit') return;
    this.updateHover();
    if (button === 2) {
      if (this.hovered) this.deletePiece(this.hovered);
      return;
    }
    if (button !== 0) return;

    // A click on empty space while a piece is picked just deselects it.
    if (this.picked && !this.hovered) {
      const port = this.nearestOpenPort(PORT_CLICK_PX);
      if (!port) {
        this.pick(null);
        return;
      }
    }

    if (this.toolMode === 'chain') {
      // 1. Click on an open port: make it the active one (clicking the active port again places).
      const port = this.nearestOpenPort(PORT_CLICK_PX);
      if (port && !(this.activePort && port.pos.distanceToSquared(this.activePort.pos) < 1e-4)) {
        this.setActivePort(port);
        return;
      }
      // 2. Click on a piece: pick it (unless a port was clicked).
      if (!port && this.hovered) {
        this.pick(this.hovered === this.picked ? null : this.hovered);
        return;
      }
      // 3. Otherwise confirm the candidate.
      if (this.selectedDef) this.place();
      else this.pick(null);
      return;
    }

    // Free mode: place under the mouse, or pick what is under it.
    if (this.selectedDef) this.place();
    else this.pick(this.hovered === this.picked ? null : this.hovered);
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (k === 'tab') {
      e.preventDefault();
      return this.setMode(this.mode === 'edit' ? 'play' : 'edit');
    }
    if (k === 'f' && !ctrl) return this.focus();

    if (this.mode === 'play') {
      const g = this.game;
      switch (k) {
        case ' ':
          e.preventDefault();
          g.spawnAtStart();
          break;
        case 'b':
          g.spawnBurst(8);
          break;
        case 'n':
          g.setAutoSpawn(!g.autoSpawn);
          break;
        case 'r':
          g.clearMarbles();
          g.spawnAtStart();
          break;
        case 't':
          g.setTimeScale(g.timeScale === 1 ? 0.25 : 1);
          break;
        case 'c':
          g.setFollow(!g.follow);
          break;
        case 'p':
          g.setPaused(!g.isPaused);
          this.changed();
          break;
        case 'm':
          g.audio.setMuted(!g.audio.muted);
          this.changed();
          break;
        case 'd':
          g.setDebug(!g.physics.debugEnabled);
          break;
      }
      return;
    }

    // --- edit mode
    if (ctrl && k === 'z' && !e.shiftKey) {
      e.preventDefault();
      return void this.undo();
    }
    if ((ctrl && k === 'y') || (ctrl && k === 'z' && e.shiftKey)) {
      e.preventDefault();
      return void this.redo();
    }
    if (ctrl) return;

    const pieceIdx = PIECE_KEYS.indexOf(e.key);
    if (pieceIdx >= 0) return this.selectByIndex(pieceIdx);

    switch (k) {
      case 'enter':
        this.place();
        break;
      case 'r':
        if (this.picked) this.rotatePicked();
        else this.rotate();
        break;
      case 'v':
        this.cycleVariant(e.shiftKey ? -1 : 1);
        break;
      case 'q':
        if (this.picked && this.toolMode === 'free') this.movePicked(0, -1, 0);
        else this.setLevel(this.level - 1);
        break;
      case 'e':
        if (this.picked && this.toolMode === 'free') this.movePicked(0, 1, 0);
        else this.setLevel(this.level + 1);
        break;
      case 'escape':
        this.select(null);
        this.pick(null);
        break;
      case 'delete':
        if (this.picked ?? this.hovered) this.deletePiece((this.picked ?? this.hovered)!);
        break;
      case 'backspace':
        e.preventDefault();
        if (this.picked) this.deletePiece(this.picked);
        else if (this.toolMode === 'chain') this.undo();
        break;
      case 'w':
        this.pan(0, 1);
        break;
      case 's':
        this.pan(0, -1);
        break;
      case 'a':
        this.pan(-1, 0);
        break;
      case 'd':
        this.pan(1, 0);
        break;
      case 'arrowup':
      case 'arrowdown':
      case 'arrowleft':
      case 'arrowright': {
        if (!this.picked || this.toolMode !== 'free') break;
        e.preventDefault();
        const step = this.screenArrowToGrid(k);
        this.movePicked(step.x, 0, step.z);
        break;
      }
    }
  }

  /** Map an arrow key to a grid step that matches what the user sees on screen. */
  private screenArrowToGrid(key: string): { x: number; z: number } {
    const fwd = new THREE.Vector3();
    this.game.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const rgt = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const snap = (v: THREE.Vector3) => (Math.abs(v.x) >= Math.abs(v.z) ? { x: Math.sign(v.x), z: 0 } : { x: 0, z: Math.sign(v.z) });
    if (key === 'arrowup') return snap(fwd);
    if (key === 'arrowdown') return snap(fwd.negate());
    if (key === 'arrowright') return snap(rgt);
    return snap(rgt.negate());
  }

  // ---------------------------------------------------------------- per-frame

  update(): void {
    if (this.mode !== 'edit') {
      this.portMarkers.visible = false;
      this.activeMarker.visible = false;
      this.guide.visible = false;
      this.guideFoot.visible = false;
      this.ghost.hide();
      const panel = (this.pickedPanel ??= document.getElementById('picked-panel'));
      if (panel) panel.hidden = true;
      const g = this.game;
      const flags = [g.timeScale !== 1 ? '慢动作' : '', g.follow ? '跟随中' : '', g.autoSpawn ? '连发中' : '', g.isPaused ? '已暂停' : ''].filter(Boolean).join('  ');
      this.game.hudExtra = `试玩模式  ${flags}  [Tab] 回编辑`;
      return;
    }
    this.portMarkers.visible = true;
    this.refreshPortMarkers();
    this.updateHover();
    this.updateCandidate();
    this.updateHighlight();
    this.updateActiveMarker();
    this.updatePickedPanel();
    this.game.hudExtra = this.hudText();
  }

  private hudText(): string {
    const tool = this.selectedDef ? `零件 ${this.selectedDef.name}` : '未选零件';
    let line1: string;
    if (this.toolMode === 'chain') {
      const state = !this.selectedDef
        ? this.activePort
          ? `按数字键或点零件栏选零件，会接在橙色接口上${this.chainDir === 'backward' ? '（正在从入口倒着铺）' : ''}`
          : this.game.track.pieces.length === 0
            ? '轨道为空：选零件后点地面放第一块'
            : '没有空接口可接：删掉一块再接，或切到自由模式'
        : this.candidateMessage
          ? this.candidateMessage
          : this.candidate?.snapped
            ? `${this.candidate.closes ? '两端都接上了！' : '接在橙色接口上'}${this.candidate.alternatives > 1 ? `（接法 ${this.snapIndex + 1}/${this.candidate.alternatives}，R 切换）` : ''}，Enter/点击确认`
            : `自由放置：层 ${this.level}，点地面放置`;
      line1 = `接龙模式  ${tool}  ${state}`;
    } else {
      const state = this.candidate ? (this.candidate.snapped ? `${this.candidate.closes ? '两端都接上了！' : '吸附'}${this.candidate.alternatives > 1 ? `（${this.snapIndex + 1}/${this.candidate.alternatives}，R 切换）` : ''}` : `自由放置 层 ${this.level} 旋转 ${this.rot * 90}°`) : '';
      line1 = `自由模式  ${tool}  ${state}`;
    }
    const variants = this.variantContext ? variantsOf(this.variantContext) : [];
    const variantHint = variants.length > 1 ? `  V 换规格（${this.variantContext!.family!.label}）` : '';
    const picked = this.picked ? `  已选中「${this.picked.def.name}」：R 旋转  Delete 删除${this.toolMode === 'free' ? '  Q/E 升降  方向键平移' : ''}${variantHint}` : variantHint;
    const line2 =
      this.toolMode === 'chain'
        ? '[1-9] 选零件  [R] 换接法  [Backspace] 撤掉上一块  [点黄点] 换接口  [WASD] 平移  [F] 聚焦  [Tab] 试玩'
        : '[Q/E] 层  [Shift+滚轮] 层  [R] 旋转  [Ctrl+Z] 撤销  [WASD] 平移  [F] 聚焦  [Tab] 试玩';
    return `${line1}${picked}\n${line2}`;
  }

  private setRayFromPointer(): boolean {
    if (!this.pointerInside) return false;
    const w = this.game.renderer.domElement.clientWidth;
    const h = this.game.renderer.domElement.clientHeight;
    const ndc = new THREE.Vector2((this.pointerPx.x / w) * 2 - 1, -(this.pointerPx.y / h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.game.camera);
    return true;
  }

  private updateHover(): void {
    this.hovered = null;
    if (!this.setRayFromPointer()) return;
    const hits = this.raycaster.intersectObjects(this.game.track.root.children, true);
    if (hits.length) this.hovered = this.game.track.instanceFromObject(hits[0].object);
  }

  private updateHighlight(): void {
    const target = this.picked ?? (this.selectedDef && this.toolMode === 'free' ? null : this.hovered);
    if (target) {
      this.highlight.setFromObject(target.group);
      this.highlight.visible = true;
    } else {
      this.highlight.visible = false;
    }
  }

  private updateActiveMarker(): void {
    if (this.toolMode === 'chain' && this.activePort) {
      this.activeMarker.visible = true;
      this.activeMarker.position.copy(this.activePort.pos).add(new THREE.Vector3(0, 0.15, 0));
      const s = 1 + 0.15 * Math.sin(performance.now() / 180);
      this.activeMarker.scale.setScalar(s);
    } else {
      this.activeMarker.visible = false;
    }
  }

  private updatePickedPanel(): void {
    // The panel is created by the UI layer after the editor, so look it up lazily.
    const el = (this.pickedPanel ??= document.getElementById('picked-panel'));
    if (!el) return;
    if (!this.picked) {
      el.hidden = true;
      return;
    }
    const box = new THREE.Box3().setFromObject(this.picked.group);
    const top = new THREE.Vector3(box.min.x + (box.max.x - box.min.x) / 2, box.max.y, box.min.z + (box.max.z - box.min.z) / 2);
    const s = this.projectToPx(top);
    el.hidden = s.behind;
    el.style.left = `${Math.round(s.x)}px`;
    el.style.top = `${Math.round(s.y) - 12}px`;
    el.dataset.toolMode = this.toolMode;
  }

  updateCandidate(): void {
    const def = this.selectedDef;
    this.candidateMessage = '';
    this.guide.visible = false;
    this.guideFoot.visible = false;
    if (!def) {
      this.candidate = null;
      this.ghost.hide();
      return;
    }
    let placed: PlacedPiece | null = null;
    let snapped = false;
    let alternatives = 0;
    let snapTarget: WorldPort | null = null;

    if (this.toolMode === 'chain' && this.activePort) {
      snapTarget = this.activePort;
      const sols = this.sortedSolutions(def, this.activePort);
      if (!sols.length) {
        this.candidateMessage = `「${def.name}」接不上这个接口（方向或高度不匹配）`;
        this.candidate = null;
        this.ghost.hide();
        return;
      }
      alternatives = sols.length;
      placed = sols[this.snapIndex % sols.length];
      snapped = true;
    } else {
      if (!this.pointerInside) {
        this.candidate = null;
        this.ghost.hide();
        return;
      }
      if (this.toolMode === 'free') {
        const port = this.nearestOpenPort(SNAP_PX);
        if (port) {
          const sols = this.sortedSolutions(def, port);
          if (sols.length) {
            alternatives = sols.length;
            placed = sols[this.snapIndex % sols.length];
            snapped = true;
            snapTarget = port;
          }
        }
      }
      if (!placed) {
        const hit = this.groundHit(this.level * H);
        if (!hit) {
          this.candidate = null;
          this.ghost.hide();
          return;
        }
        placed = {
          def: def.id,
          cell: { x: Math.round(hit.x / CELL), z: Math.round(hit.z / CELL) },
          level: this.level,
          rot: this.rot,
        };
        // Height guide: dashed line from the piece origin down to the ground, with a ring at the foot.
        const origin = new THREE.Vector3(placed.cell.x * CELL, placed.level * H, placed.cell.z * CELL);
        this.guide.position.copy(origin);
        this.guide.scale.set(1, Math.max(origin.y, 0.001), 1);
        this.guide.computeLineDistances();
        this.guide.visible = origin.y > 0.05;
        this.guideFoot.position.set(origin.x, 0.02, origin.z);
        this.guideFoot.visible = true;
      }
    }
    const valid = this.game.track.canPlace(def, placed);
    const closes = this.closesGap(def, placed, snapTarget ?? undefined);
    this.candidate = { placed, valid, snapped, alternatives, closes };
    this.ghost.setDef(def);
    this.ghost.setPlacement(placed);
    this.ghost.setValid(valid, closes);
    this.ghost.show();
  }

  /**
   * Snap solutions ordered by usefulness: ones that also close a gap first, then ones
   * whose connecting port matches the chaining direction (forwards: the new piece's entry
   * meets the target; backwards: its exit does), then definition order.
   */
  private sortedSolutions(def: PieceDef, target: WorldPort): PlacedPiece[] {
    const sols = snapSolutions(def, target);
    const wanted = this.chainDir === 'backward' ? 'out' : 'in';
    const connectingKind = (p: PlacedPiece) => worldPorts(def, p).find((wp) => wp.pos.distanceToSquared(target.pos) < 1e-4)?.kind;
    return sols
      .map((p, i) => {
        const k = connectingKind(p);
        return { p, i, closes: this.closesGap(def, p, target), dirOk: k === wanted || k === 'both' };
      })
      .sort((a, b) => Number(b.closes) - Number(a.closes) || Number(b.dirOk) - Number(a.dirOk) || a.i - b.i)
      .map((x) => x.p);
  }

  /** Does any port of the placed piece (other than the one on `except`) coincide with an existing open port? */
  private closesGap(def: PieceDef, placed: PlacedPiece, except?: WorldPort): boolean {
    const open = this.game.track.openPorts();
    for (const p of worldPorts(def, placed)) {
      if (except && p.pos.distanceToSquared(except.pos) < 1e-4) continue;
      if (open.some((o) => o.port.pos.distanceToSquared(p.pos) < 1e-4 && o.port.dir.dot(p.dir) < -0.99)) return true;
    }
    return false;
  }

  /** World position -> CSS pixel position on the canvas. */
  projectToPx(v: THREE.Vector3): { x: number; y: number; behind: boolean } {
    const w = this.game.renderer.domElement.clientWidth;
    const h = this.game.renderer.domElement.clientHeight;
    const p = v.clone().project(this.game.camera);
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, behind: p.z > 1 };
  }

  private nearestOpenPort(maxPx: number): WorldPort | null {
    if (!this.pointerInside) return null;
    let best: WorldPort | null = null;
    let bestD = maxPx;
    for (const { port } of this.game.track.openPorts()) {
      const s = this.projectToPx(port.pos);
      if (s.behind) continue;
      const d = Math.hypot(s.x - this.pointerPx.x, s.y - this.pointerPx.y);
      if (d < bestD) {
        bestD = d;
        best = port;
      }
    }
    return best;
  }

  private groundHit(y: number): THREE.Vector3 | null {
    if (!this.setRayFromPointer()) return null;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out);
  }

  private changed(): void {
    this.onChange?.();
  }
}
