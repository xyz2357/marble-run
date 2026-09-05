import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PhysicsWorld } from '../physics/world';
import { spawnMarble, removeMarble, type Marble } from './marble';

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly physics: PhysicsWorld;
  readonly marbles: Marble[] = [];
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
    this.setupStage0Scene();

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

  /** Stage 0: ground + a static ramp + a starting marble. */
  private setupStage0Scene(): void {
    // Ground
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xcfd8c2, roughness: 0.95 });
    const ground = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 40), groundMat);
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const gBody = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.1, 20).setFriction(0.8), gBody);

    // Ramp: a box tilted 20 degrees about Z, with small side rails
    const wood = new THREE.MeshStandardMaterial({ color: 0xc89b63, roughness: 0.8 });
    const rampLen = 6;
    const rampW = 0.8;
    const tilt = THREE.MathUtils.degToRad(20);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -tilt);
    const rampPos = new THREE.Vector3(0, 1.2, 0);

    const rampGroup = new THREE.Group();
    rampGroup.position.copy(rampPos);
    rampGroup.quaternion.copy(q);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(rampLen, 0.1, rampW), wood);
    deck.castShadow = deck.receiveShadow = true;
    rampGroup.add(deck);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(rampLen, 0.25, 0.06), wood);
      rail.position.set(0, 0.12, side * (rampW / 2 - 0.03));
      rail.castShadow = rail.receiveShadow = true;
      rampGroup.add(rail);
    }
    this.scene.add(rampGroup);

    const rBody = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(rampPos.x, rampPos.y, rampPos.z).setRotation(q),
    );
    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(rampLen / 2, 0.05, rampW / 2).setFriction(0.6), rBody);
    for (const side of [-1, 1]) {
      this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(rampLen / 2, 0.125, 0.03).setTranslation(0, 0.12, side * (rampW / 2 - 0.03)),
        rBody,
      );
    }

    // Starting marble near the high end of the ramp
    const top = new THREE.Vector3(-rampLen / 2 + 0.4, 0.4, 0).applyQuaternion(q).add(rampPos);
    this.spawnMarble(top);
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
    if (e.key === ' ') {
      this.spawnMarble({ x: -2.4 + Math.random() * 0.2, y: 2.6, z: (Math.random() - 0.5) * 0.3 });
    }
    if (e.key === 'r' || e.key === 'R') this.clearMarbles();
    if (e.key === 'p' || e.key === 'P') this.setPaused(!this.paused);
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
