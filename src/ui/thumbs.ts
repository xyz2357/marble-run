import * as THREE from 'three';
import { MATERIALS } from '../game/track';
import type { PieceDef } from '../pieces/types';

/** Render a small preview image of each piece into its own canvas. */
export function renderThumbnails(defs: PieceDef[], size: number): Map<string, HTMLCanvasElement> {
  const out = new Map<string, HTMLCanvasElement>();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);

  for (const def of defs) {
    const group = new THREE.Group();
    const built = def.build();
    for (const part of built.parts) group.add(new THREE.Mesh(part.geometry, MATERIALS[part.material]));
    scene.add(group);

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() * 0.5;
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.copy(center).add(new THREE.Vector3(0.8, 0.9, 1.1).normalize().multiplyScalar(dist));
    camera.lookAt(center);
    renderer.render(scene, camera);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    out.set(def.id, canvas);

    scene.remove(group);
    for (const part of built.parts) part.geometry.dispose();
  }

  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
