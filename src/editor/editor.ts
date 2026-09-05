import * as THREE from 'three';
import type { Game } from '../game/game';
import { buildDemoTrack } from '../game/demo';
import { snapSolutions, type TrackPieceInstance } from '../game/track';
import { getPiece, PIECES } from '../pieces/registry';
import { CELL, H, type PieceDef, type PlacedPiece } from '../pieces/types';
import { Ghost } from './ghost';

export type Mode = 'edit' | 'play';

export const AUTOSAVE_KEY = 'marble-run.autosave.v1';
const SNAP_PX = 48;
const CLICK_PX = 6;
const MAX_UNDO = 100;
const MIN_LEVEL = 0;
const MAX_LEVEL = 40;

export interface Candidate {
  placed: PlacedPiece;
  valid: boolean;
  snapped: boolean;
  /** Number of alternative snap solutions at this port (R cycles through them). */
  alternatives: number;
}

export interface SaveFile {
  version: 1;
  pieces: PlacedPiece[];
}

/**
 * Track editor: piece palette selection, ghost preview with port snapping,
 * placement / deletion, undo/redo, autosave, edit/play mode.
 */
export class Editor {
  mode: Mode = 'edit';
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
  /** UI refresh callback. */
  onChange: (() => void) | null = null;

  private ghost: Ghost;
  private highlight: THREE.BoxHelper;
  /** Small markers on every open (unconnected) port, shown in edit mode. */
  private portMarkers = new THREE.Group();
  private portMarkerGeo = new THREE.SphereGeometry(0.09, 12, 8);
  private portMarkerMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthTest: false });
  private portMarkersDirty = true;
  private pointerPx = { x: -1, y: -1 };
  private pointerInside = false;
  private raycaster = new THREE.Raycaster();
  private downPos: { x: number; y: number; button: number } | null = null;
  private undoStack: PlacedPiece[][] = [];
  private redoStack: PlacedPiece[][] = [];
  private dirty = true;

  constructor(private game: Game) {
    this.ghost = new Ghost(game.scene);
    this.highlight = new THREE.BoxHelper(new THREE.Object3D(), 0xffd166);
    this.highlight.visible = false;
    game.scene.add(this.highlight);
    this.portMarkers.renderOrder = 20;
    game.scene.add(this.portMarkers);

    const el = game.renderer.domElement;
    el.addEventListener('pointermove', (e) => {
      this.pointerPx = { x: e.clientX, y: e.clientY };
      this.pointerInside = true;
      this.dirty = true;
    });
    el.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      this.dirty = true;
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
      this.dirty = true;
    }
    this.changed();
  }

  // ---------------------------------------------------------------- tool state

  select(defId: string | null): void {
    this.selectedDef = defId ? getPiece(defId) : null;
    this.snapIndex = 0;
    this.picked = null;
    this.dirty = true;
    this.changed();
  }

  setLevel(level: number): void {
    this.level = THREE.MathUtils.clamp(Math.round(level), MIN_LEVEL, MAX_LEVEL);
    this.dirty = true;
    this.changed();
  }

  /** R key: cycle snap alternatives when snapped, otherwise rotate the free placement. */
  rotate(): void {
    if (this.candidate?.snapped && this.candidate.alternatives > 1) {
      this.snapIndex = (this.snapIndex + 1) % this.candidate.alternatives;
    } else {
      this.rot = ((this.rot + 1) % 4) as 0 | 1 | 2 | 3;
    }
    this.dirty = true;
    this.changed();
  }

  // ---------------------------------------------------------------- mutations

  /** Place the current candidate if valid. Returns the new instance or null. */
  place(): TrackPieceInstance | null {
    if (this.mode !== 'edit' || !this.candidate?.valid) return null;
    this.pushUndo();
    const inst = this.game.track.place(this.candidate.placed);
    this.afterMutation();
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

  loadDemo(): void {
    this.pushUndo();
    this.game.track.clear();
    buildDemoTrack(this.game.track);
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

  private afterMutation(): void {
    this.autosave();
    this.dirty = true;
    this.portMarkersDirty = true;
    this.changed();
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
      return this.game.track.pieces.length > 0;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- input

  private click(button: number): void {
    if (this.mode !== 'edit') return;
    this.dirty = true;
    this.update();
    if (button === 0) {
      if (this.selectedDef) {
        this.place();
      } else {
        this.picked = this.hovered === this.picked ? null : this.hovered;
        this.changed();
      }
    } else if (button === 2) {
      if (this.hovered) this.deletePiece(this.hovered);
    }
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (k === 'd') return this.game.setDebug(!this.game.physics.debugEnabled);
    if (k === 'tab') {
      e.preventDefault();
      return this.setMode(this.mode === 'edit' ? 'play' : 'edit');
    }

    if (this.mode === 'play') {
      if (k === ' ') {
        e.preventDefault();
        this.game.spawnAtStart();
      } else if (k === 'r') {
        this.game.clearMarbles();
        this.game.spawnAtStart();
      } else if (k === 'p') {
        this.game.setPaused(!this.game.isPaused);
      }
      return;
    }

    if (ctrl && k === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if ((ctrl && k === 'y') || (ctrl && k === 'z' && e.shiftKey)) {
      e.preventDefault();
      this.redo();
    } else if (k === 'r') {
      this.rotate();
    } else if (k === 'q') {
      this.setLevel(this.level - 1);
    } else if (k === 'e') {
      this.setLevel(this.level + 1);
    } else if (k === 'escape') {
      this.select(null);
    } else if (k === 'delete' || k === 'backspace') {
      const target = this.picked ?? this.hovered;
      if (target) this.deletePiece(target);
    }
  }

  // ---------------------------------------------------------------- per-frame

  /** Recompute hover + placement candidate when the pointer or state changed. */
  update(): void {
    if (this.mode !== 'edit') {
      this.portMarkers.visible = false;
      this.game.hudExtra = '试玩模式  [Space] 放弹珠  [R] 重置  [P] 暂停  [Tab] 回编辑';
      return;
    }
    this.portMarkers.visible = true;
    this.refreshPortMarkers();
    // Camera may have moved; always refresh in edit mode (cheap for small tracks).
    this.dirty = false;
    this.updateHover();
    this.updateCandidate();
    this.updateHighlight();
    const tool = this.selectedDef ? `零件 ${this.selectedDef.name}` : '未选零件（点击零件可选中，右键/Delete 删除）';
    const snap = this.candidate ? (this.candidate.snapped ? `吸附${this.candidate.alternatives > 1 ? ` (${this.snapIndex + 1}/${this.candidate.alternatives}, R 切换)` : ''}` : `自由放置 层 ${this.level} 旋转 ${this.rot * 90}°`) : '';
    this.game.hudExtra = `编辑模式  ${tool}  ${snap}\n[Q/E] 层 ${this.level}  [R] 旋转  [Ctrl+Z] 撤销  [Tab] 试玩`;
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
    const target = this.picked ?? (this.selectedDef ? null : this.hovered);
    if (target) {
      this.highlight.setFromObject(target.group);
      this.highlight.visible = true;
    } else {
      this.highlight.visible = false;
    }
  }

  private updateCandidate(): void {
    const def = this.selectedDef;
    if (!def || !this.pointerInside) {
      this.candidate = null;
      this.ghost.hide();
      return;
    }
    let placed: PlacedPiece | null = null;
    let snapped = false;
    let alternatives = 0;

    const port = this.nearestOpenPort();
    if (port) {
      const sols = snapSolutions(def, port);
      if (sols.length) {
        alternatives = sols.length;
        placed = sols[this.snapIndex % sols.length];
        snapped = true;
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
    }
    const valid = this.game.track.canPlace(def, placed);
    this.candidate = { placed, valid, snapped, alternatives };
    this.ghost.setDef(def);
    this.ghost.setPlacement(placed);
    this.ghost.setValid(valid);
    this.ghost.show();
  }

  /** World position -> CSS pixel position on the canvas. */
  projectToPx(v: THREE.Vector3): { x: number; y: number; behind: boolean } {
    const w = this.game.renderer.domElement.clientWidth;
    const h = this.game.renderer.domElement.clientHeight;
    const p = v.clone().project(this.game.camera);
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, behind: p.z > 1 };
  }

  private nearestOpenPort(): import('../pieces/types').WorldPort | null {
    let best: import('../pieces/types').WorldPort | null = null;
    let bestD = SNAP_PX;
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
