import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PhysicsWorld } from '../physics/world';
import { spawnMarble, removeMarble, type Marble } from './marble';
import { Track } from './track';
import { buildDemoTrack } from './demo';

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly physics: PhysicsWorld;
  readonly marbles: Marble[] = [];
  readonly track: Track;
  /** Marble ids that have reached a goal, in order. */
  readonly finished: number[] = [];
  private paused = false;
  private lastTime = performance.now();
  private hud: HTMLElement | null;
  private frames = 0;
  private fpsTimer = 0;
  private fps = 0;

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

    this.scene.background = new THREE.Color(0x9fc5e8);
    this.scene.fog = new THREE.Fog(0x9fc5e8, 40, 120);

    this.physics = new PhysicsWorld();
    this.hud = document.getElementById('hud');

    this.setupLights();
    this.setupGround();
    this.track = new Track(this.physics, this.scene);
    buildDemoTrack(this.track);
    this.frameTrack();
    this.spawnAtStart();

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 0.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
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
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xcfd8c2, roughness: 0.95 });
    const ground = new THREE.Mesh(new THREE.BoxGeometry(80, 0.2, 80), groundMat);
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const gBody = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.1, 40).setFriction(0.8), gBody);

    const grid = new THREE.GridHelper(80, 80, 0x99a08a, 0xb5bca8);
    grid.position.y = 0.01;
    this.scene.add(grid);
  }

  /** Point the camera at the bounding box of the current track. */
  frameTrack(): void {
    const box = new THREE.Box3().setFromObject(this.track.root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    this.controls.target.copy(center);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.9;
    this.camera.position.copy(center).add(new THREE.Vector3(0.7, 0.6, 1).normalize().multiplyScalar(dist));
    this.controls.update();
  }

  /** Spawn one marble at every start piece. Returns the marbles created. */
  spawnAtStart(): Marble[] {
    return this.track.spawnPoints().map((p) => this.spawnMarble(p));
  }

  spawnMarble(pos: THREE.Vector3Like, color?: number): Marble {
    const palette = [0x3aa0ff, 0xff5a5a, 0x5ad46a, 0xffc93a, 0xc36bff, 0xff8a3a];
    const c = color ?? palette[this.marbles.length % palette.length];
    const m = spawnMarble(this.physics, this.scene, pos, c);
    this.marbles.push(m);
    return m;
  }

  clearMarbles(): void {
    for (const m of this.marbles) removeMarble(this.physics, this.scene, m);
    this.marbles.length = 0;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.lastTime = performance.now();
  }

  setDebug(on: boolean): void {
    this.physics.setDebug(this.scene, on);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'd' || e.key === 'D') this.setDebug(!this.physics.debugEnabled);
    if (e.key === ' ') this.spawnAtStart();
    if (e.key === 'r' || e.key === 'R') {
      this.clearMarbles();
      this.finished.length = 0;
    }
    if (e.key === 'p' || e.key === 'P') this.setPaused(!this.paused);
  }

  /** Mark marbles inside any goal box as finished (once). Also cull marbles that fell off the world. */
  checkGoals(): void {
    const goals = this.track.goals();
    const tmp = new THREE.Vector3();
    for (const m of [...this.marbles]) {
      const t = m.body.translation();
      tmp.set(t.x, t.y, t.z);
      if (t.y < -5) {
        removeMarble(this.physics, this.scene, m);
        this.marbles.splice(this.marbles.indexOf(m), 1);
        continue;
      }
      if (!this.finished.includes(m.id) && goals.some((g) => g.containsPoint(tmp))) {
        this.finished.push(m.id);
      }
    }
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (!this.paused) this.physics.update(dt);
    else this.physics.syncMeshes();
    this.checkGoals();
    this.physics.updateDebug();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }
    if (this.hud) {
      this.hud.textContent =
        `FPS ${this.fps}  marbles ${this.marbles.length}  steps ${this.physics.stepCount}` +
        `\n[Space] 放弹珠  [R] 清空  [D] 物理线框  [P] 暂停${this.paused ? ' (已暂停)' : ''}`;
    }
  }
}
