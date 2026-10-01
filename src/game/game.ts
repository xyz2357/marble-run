import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FIXED_DT, PhysicsWorld } from '../physics/world';
import { AudioEngine, type MarbleAudioState } from './audio';
import { spawnMarble, removeMarble, getMarbleType, type Marble } from './marble';
import { Track } from './track';
import type { MarbleInfo } from '../pieces/types';

export const MARBLE_COLORS = [0x3aa0ff, 0xff5a5a, 0x5ad46a, 0xffc93a, 0xc36bff, 0xff8a3a, 0x2dd4bf, 0xf472b6];
const MAX_MARBLES = 60;
const BURST_INTERVAL = 0.35;
const AUTO_INTERVAL = 1.2;
const MAX_STEPS_PER_FRAME = 8;
/** Playback speeds the play bar cycles through. */
export const SPEEDS = [1, 2, 3, 4];

/**
 * Two looks for the same scene. 'workshop' is the editor's: sky, grid. 'tabletop' imitates a desk
 * toy filmed up close: a white table, no grid, a long lens with the background out of focus. The
 * track itself keeps its own material either way.
 */
const LOOKS = {
  workshop: { sky: 0x9fc5e8, fogNear: 40, fogFar: 120, ground: 0xcfd8c2, hemi: 0.6, bounce: 0x8a7a5a, sun: 2.2, fov: 50 },
  // A white table throws light back up under the track, so the bounce colour is near-white too.
  tabletop: { sky: 0xe9e6e1, fogNear: 30, fogFar: 90, ground: 0xf4f2ee, hemi: 1.3, bounce: 0xd9d4ca, sun: 1.6, fov: 30 },
};

export interface RaceResult {
  id: number;
  /** As rendered, so the race list's dot matches the marble (steel is tinted grey). */
  color: number;
  /** Seconds from spawn to goal. */
  time: number;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly physics: PhysicsWorld;
  readonly audio = new AudioEngine();
  readonly marbles: Marble[] = [];
  readonly track: Track;
  /** Marble ids that have reached a goal, in order. */
  readonly finished: number[] = [];
  readonly results: RaceResult[] = [];
  /** Simulation seconds since the last reset. */
  simTime = 0;
  /** 1 = realtime, 0.25 = slow motion. */
  timeScale = 1;
  /**
   * Playback rate on top of `timeScale`. Only how many fixed steps run per wall-clock second
   * changes, so every tuned mechanism behaves exactly as at 1x - it just plays back faster.
   */
  speed = 1;
  /** Desk-toy look (see LOOKS). */
  tabletop = false;
  /** Follow the leading marble with the camera. */
  follow = false;
  /** Keep spawning a marble every AUTO_INTERVAL seconds. */
  autoSpawn = false;
  /** MARBLE_TYPES id used for newly spawned marbles. */
  marbleType = 'glass';
  /** Extra status text appended to the HUD (set by the editor). */
  hudExtra = '';
  /** Called once per frame before rendering (the editor hooks in here). */
  beforeRender: (() => void) | null = null;
  /** Called whenever marbles / results change (UI refresh). */
  onRaceChange: (() => void) | null = null;

  private paused = false;
  private accumulator = 0;
  private lastTime = performance.now();
  private hud: HTMLElement | null;
  private frames = 0;
  private fpsTimer = 0;
  private fps = 0;
  private spawnQueue: number[] = []; // sim times at which to spawn
  private nextAutoSpawn = 0;
  private colorIndex = 0;
  private tmpV = new THREE.Vector3();
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private groundMat!: THREE.MeshStandardMaterial;
  private grid!: THREE.GridHelper;
  private gridWanted = true;
  /** Built the first time the tabletop look is switched on. */
  private composer: EffectComposer | null = null;
  private bokeh: BokehPass | null = null;
  /** Marble type to go back to when the tabletop look (which brings steel balls) is switched off. */
  private typeBeforeTabletop: string | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 200);
    this.camera.position.set(6, 5, 8);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;

    this.scene.background = new THREE.Color(0x9fc5e8);
    this.scene.fog = new THREE.Fog(0x9fc5e8, 40, 120);

    this.physics = new PhysicsWorld();
    this.hud = document.getElementById('hud');
    try {
      // 'ball' is what the glass marble was called before there were several kinds.
      const saved = localStorage.getItem('marble-run.shape');
      if (saved) this.marbleType = getMarbleType(saved === 'ball' ? 'glass' : saved).id;
    } catch {
      /* ignore */
    }

    this.setupLights();
    this.setupGround();
    this.track = new Track(this.physics, this.scene);

    window.addEventListener('resize', () => this.onResize());
  }

  private setupLights(): void {
    const hemi = (this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 0.6));
    this.scene.add(hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xffffff, 2.2));
    sun.position.set(10, 15, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    const s = 15;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
  }

  private setupGround(): void {
    const groundMat = (this.groundMat = new THREE.MeshStandardMaterial({ color: 0xcfd8c2, roughness: 0.95 }));
    const ground = new THREE.Mesh(new THREE.BoxGeometry(80, 0.2, 80), groundMat);
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const gBody = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.1, 40).setFriction(0.8), gBody);

    // Grid lines on cell boundaries (cells are centered on integer coordinates).
    const grid = (this.grid = new THREE.GridHelper(80, 80, 0x99a08a, 0xb5bca8));
    grid.position.set(0.5, 0.01, 0.5);
    this.scene.add(grid);
  }

  /** The editor wants the grid while building; the tabletop look hides it otherwise. */
  setGridWanted(on: boolean): void {
    this.gridWanted = on;
    this.grid.visible = on || !this.tabletop;
  }

  /**
   * Switch between the workshop and the tabletop look. The tabletop look also swaps in steel balls,
   * a long lens framed low on the track, and 2x playback; switching back undoes all of it.
   */
  setTabletop(on: boolean): void {
    if (on === this.tabletop) return;
    this.tabletop = on;
    const look = on ? LOOKS.tabletop : LOOKS.workshop;
    (this.scene.background as THREE.Color).set(look.sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(look.sky);
    fog.near = look.fogNear;
    fog.far = look.fogFar;
    this.groundMat.color.set(look.ground);
    this.hemi.intensity = look.hemi;
    this.hemi.groundColor.set(look.bounce);
    this.sun.intensity = look.sun;
    this.camera.fov = look.fov;
    this.camera.updateProjectionMatrix();
    this.grid.visible = this.gridWanted || !on;

    if (on) {
      this.typeBeforeTabletop = this.marbleType;
      this.marbleType = 'steel';
      if (this.speed === 1) this.speed = 2;
      this.ensureComposer();
    } else {
      if (this.marbleType === 'steel' && this.typeBeforeTabletop) this.marbleType = this.typeBeforeTabletop;
      this.typeBeforeTabletop = null;
      this.speed = 1;
    }
    this.frameTrack();
    try {
      localStorage.setItem('marble-run.tabletop', on ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.onRaceChange?.();
  }

  private ensureComposer(): void {
    if (this.composer) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // Blur grows with distance from the focal plane: factor = (focus - depth) * aperture, in UV
    // units. Focused ~15 m out, the far edge of the table is ~10 m behind it -> ~0.005.
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 15, aperture: 0.0005, maxblur: 0.008 });
    composer.addPass(this.bokeh);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  // ---------------------------------------------------------------- camera

  /** Point the camera at the bounding box of the current track. */
  frameTrack(): void {
    const box = new THREE.Box3().setFromObject(this.track.root);
    if (box.isEmpty()) {
      this.controls.target.set(0, 1, 0);
      this.camera.position.set(6, 6, 9);
      this.controls.update();
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // Half the box diagonal: the longest side alone is fine for a track strung out along the floor,
    // but crops a compact tower whose height and width are both close to the longest side.
    const radius = Math.max(size.length(), 4) * 0.5;
    this.controls.target.copy(center);
    // Tabletop: product-shot framing - a long lens, low over the table (about 14 degrees up), the
    // track filling the frame, the way the desk toy is filmed rather than the editor's high iso view.
    const fill = this.tabletop ? 0.95 : 0.9;
    const dir = this.tabletop ? new THREE.Vector3(0.75, 0.32, 1) : new THREE.Vector3(0.7, 0.6, 1);
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * fill;
    this.camera.position.copy(center).add(dir.normalize().multiplyScalar(dist));
    this.controls.update();
  }

  /** The marble the follow camera tracks: the oldest one still running. */
  leader(): Marble | null {
    return this.marbles.find((m) => m.finishTime === null) ?? this.marbles[this.marbles.length - 1] ?? null;
  }

  private updateFollow(dt: number): void {
    if (!this.follow) return;
    const m = this.leader();
    if (!m) return;
    const t = m.body.translation();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const k = 1 - Math.exp(-6 * dt);
    this.controls.target.lerp(this.tmpV.set(t.x, t.y, t.z), k);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  setFollow(on: boolean): void {
    this.follow = on;
    if (on) {
      const m = this.leader();
      if (m) {
        const t = m.body.translation();
        const offset = this.camera.position.clone().sub(this.controls.target);
        const dist = Math.min(offset.length(), 7);
        this.controls.target.set(t.x, t.y, t.z);
        this.camera.position.copy(this.controls.target).add(offset.normalize().multiplyScalar(dist));
      }
    }
    this.onRaceChange?.();
  }

  // ---------------------------------------------------------------- marbles

  /** Spawn one marble at every start piece. Returns the marbles created. */
  spawnAtStart(): Marble[] {
    return this.track.spawnPoints().map((p) => this.spawnMarble(p.pos, undefined, p.dir));
  }

  spawnMarble(pos: THREE.Vector3Like, color?: number, heading?: THREE.Vector3): Marble {
    if (this.marbles.length >= MAX_MARBLES) {
      const oldest = this.marbles.find((m) => m.finishTime !== null) ?? this.marbles[0];
      this.removeOne(oldest);
    }
    const c = color ?? MARBLE_COLORS[this.colorIndex++ % MARBLE_COLORS.length];
    const m = spawnMarble(this.physics, this.scene, pos, c, this.simTime, this.marbleType, heading);
    this.marbles.push(m);
    this.onRaceChange?.();
    return m;
  }

  /** Queue n marbles per start piece, released one after another. */
  spawnBurst(n: number, interval = BURST_INTERVAL): void {
    for (let i = 0; i < n; i++) this.spawnQueue.push(this.simTime + i * interval);
  }

  setMarbleType(id: string): void {
    this.marbleType = getMarbleType(id).id;
    try {
      localStorage.setItem('marble-run.shape', this.marbleType);
    } catch {
      /* ignore */
    }
    this.onRaceChange?.();
  }

  setAutoSpawn(on: boolean): void {
    this.autoSpawn = on;
    this.nextAutoSpawn = this.simTime;
    this.onRaceChange?.();
  }

  private removeOne(m: Marble): void {
    removeMarble(this.physics, this.scene, m);
    const i = this.marbles.indexOf(m);
    if (i >= 0) this.marbles.splice(i, 1);
  }

  /** Remove all marbles and reset the race clock / results. */
  clearMarbles(): void {
    for (const m of this.marbles) removeMarble(this.physics, this.scene, m);
    this.marbles.length = 0;
    this.finished.length = 0;
    this.results.length = 0;
    this.spawnQueue.length = 0;
    this.simTime = 0;
    this.nextAutoSpawn = 0;
    this.colorIndex = 0;
    this.onRaceChange?.();
  }

  // ---------------------------------------------------------------- simulation

  setPaused(p: boolean): void {
    this.paused = p;
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  setTimeScale(s: number): void {
    this.timeScale = s;
    this.onRaceChange?.();
  }

  setSpeed(s: number): void {
    this.speed = s;
    this.onRaceChange?.();
  }

  cycleSpeed(): void {
    this.setSpeed(SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length]);
  }

  setDebug(on: boolean): void {
    this.physics.setDebug(this.scene, on);
  }

  /** Advance the simulation by n fixed steps: physics, spawn queue, goals. */
  step(n: number): void {
    const v = this.tmpV;
    let infos: MarbleInfo[] = [];
    for (let i = 0; i < n; i++) {
      // Marbles can be spawned/removed mid-run, so rebuild the info list when the set changes.
      if (infos.length !== this.marbles.length || infos.some((info, k) => info.id !== this.marbles[k].id)) {
        infos = this.marbles.map((m) => ({ id: m.id, pos: new THREE.Vector3() }));
      }
      for (let k = 0; k < this.marbles.length; k++) {
        const t = this.marbles[k].body.translation();
        infos[k].pos.set(t.x, t.y, t.z);
      }
      this.track.update(FIXED_DT, infos);
      this.physics.stepOnce();
      this.simTime += FIXED_DT;
      // Per-step velocity change: gravity contributes ~0.08 m/s per step, a real hit much more.
      for (const m of this.marbles) {
        const lv = m.body.linvel();
        v.set(lv.x, lv.y, lv.z);
        const d = m.prevVel.distanceTo(v);
        if (d > m.pendingImpact) m.pendingImpact = d;
        m.prevVel.copy(v);
      }
      this.processSpawns();
    }
    this.physics.syncMeshes();
    this.checkGoals();
  }

  private processSpawns(): void {
    let spawned = false;
    while (this.spawnQueue.length && this.spawnQueue[0] <= this.simTime) {
      this.spawnQueue.shift();
      this.spawnAtStart();
      spawned = true;
    }
    if (this.autoSpawn && this.simTime >= this.nextAutoSpawn) {
      this.nextAutoSpawn = this.simTime + AUTO_INTERVAL;
      this.spawnAtStart();
      spawned = true;
    }
    if (spawned) this.onRaceChange?.();
  }

  /** Mark marbles inside any goal box as finished (once). Also cull marbles that fell off the world. */
  checkGoals(): void {
    const goals = this.track.goals();
    let changed = false;
    for (const m of [...this.marbles]) {
      const t = m.body.translation();
      this.tmpV.set(t.x, t.y, t.z);
      if (t.y < -5) {
        this.removeOne(m);
        changed = true;
        continue;
      }
      if (m.finishTime === null && goals.some((g) => g.containsPoint(this.tmpV))) {
        m.finishTime = this.simTime;
        this.finished.push(m.id);
        this.results.push({ id: m.id, color: m.displayColor, time: this.simTime - m.spawnTime });
        changed = true;
      }
    }
    if (changed) this.onRaceChange?.();
  }

  /** Per-frame sound: rolling voices + impact clicks from velocity changes. */
  private updateAudio(): void {
    const states: MarbleAudioState[] = [];
    for (const m of this.marbles) {
      const lv = m.body.linvel();
      let contact = false;
      this.physics.world.contactPairsWith(m.collider, () => {
        contact = true;
      });
      states.push({ id: m.id, speed: Math.hypot(lv.x, lv.y, lv.z), contact, impact: m.pendingImpact, timbre: m.timbre });
      m.pendingImpact = 0;
    }
    this.audio.update(states);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;

    if (!this.paused) {
      const rate = this.timeScale * this.speed;
      const maxSteps = MAX_STEPS_PER_FRAME * Math.ceil(rate);
      this.accumulator += dt * rate;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < maxSteps) {
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === maxSteps) this.accumulator = 0;
      if (steps > 0) this.step(steps);
      else this.physics.syncMeshes();
    } else {
      this.physics.syncMeshes();
    }
    this.updateAudio();
    this.physics.updateDebug();
    this.updateFollow(dt);
    this.controls.update();
    this.beforeRender?.();
    if (this.tabletop && this.composer && this.bokeh) {
      (this.bokeh.uniforms as Record<string, THREE.IUniform>).focus.value = this.camera.position.distanceTo(this.controls.target);
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }
    if (this.hud) {
      this.hud.textContent =
        `FPS ${this.fps}  弹珠 ${this.marbles.length}  到达 ${this.finished.length}  零件 ${this.track.pieces.length}` +
        (this.hudExtra ? `\n${this.hudExtra}` : '');
    }
  }
}
