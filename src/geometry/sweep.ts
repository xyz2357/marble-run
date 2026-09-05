import * as THREE from 'three';

/** Path sample: position and unit tangent at parameter t in [0,1]. */
export type PathFn = (t: number) => { pos: THREE.Vector3; tan: THREE.Vector3 };

/** Closed 2D profile in (side, up) coordinates, counter-clockwise. */
export type Profile = [number, number][];

/**
 * Standard U-shaped track profile. Inner deck 0.6 wide with chamfers,
 * rails 0.2 tall, 0.06 thick, deck 0.08 thick. Marble radius is 0.15.
 */
export const TRACK_PROFILE: Profile = [
  [-0.36, 0.2],
  [-0.36, -0.08],
  [0.36, -0.08],
  [0.36, 0.2],
  [0.3, 0.2],
  [0.3, 0.06],
  [0.16, 0.0],
  [-0.16, 0.0],
  [-0.3, 0.06],
  [-0.3, 0.2],
];

export const TRACK_HALF_WIDTH = 0.36;
export const RAIL_HEIGHT = 0.2;

/** Deck plus the rail on the -side only (used for the outer side of a branch). Closed, CCW. */
export const HALF_PROFILE_LEFT: Profile = [
  [-0.36, 0.2],
  [-0.36, -0.08],
  [0.24, -0.08],
  [0.24, 0.0],
  [-0.16, 0.0],
  [-0.3, 0.06],
  [-0.3, 0.2],
];
/** Mirror of HALF_PROFILE_LEFT: deck plus the rail on the +side. */
export const HALF_PROFILE_RIGHT: Profile = [...HALF_PROFILE_LEFT].reverse().map(([s, u]) => [-s, u] as [number, number]);
/** Just a rail on the +side (an inner divider rail). */
export const RAIL_PROFILE_RIGHT: Profile = [
  [0.24, 0.2],
  [0.24, -0.08],
  [0.36, -0.08],
  [0.36, 0.2],
];
export const RAIL_PROFILE_LEFT: Profile = [...RAIL_PROFILE_RIGHT].reverse().map(([s, u]) => [-s, u] as [number, number]);

/** Triangulate a profile for an end cap, tolerating coincident consecutive points (collapsed features). */
function capTriangles(profile: Profile): [number, number, number][] {
  const map: number[] = [];
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < profile.length; i++) {
    const [s, u] = profile[i];
    const prev = pts[pts.length - 1];
    if (prev && Math.abs(prev.x - s) < 1e-6 && Math.abs(prev.y - u) < 1e-6) continue;
    pts.push(new THREE.Vector2(s, u));
    map.push(i);
  }
  if (pts.length > 1 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-6 && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-6) {
    pts.pop();
    map.pop();
  }
  if (pts.length < 3) return [];
  return THREE.ShapeUtils.triangulateShape(pts, []).map(([a, b, c]) => [map[a], map[b], map[c]] as [number, number, number]);
}

/** Point-wise blend of two profiles with the same vertex count. */
export function lerpProfile(a: Profile, b: Profile, t: number): Profile {
  return a.map(([s, u], i) => [s + (b[i][0] - s) * t, u + (b[i][1] - u) * t] as [number, number]);
}

/** Cubic Bezier path (tangent from the derivative). */
export function bezierPath(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3): PathFn {
  return (t) => {
    const u = 1 - t;
    const pos = new THREE.Vector3()
      .addScaledVector(p0, u * u * u)
      .addScaledVector(p1, 3 * u * u * t)
      .addScaledVector(p2, 3 * u * t * t)
      .addScaledVector(p3, t * t * t);
    const tan = new THREE.Vector3()
      .addScaledVector(new THREE.Vector3().subVectors(p1, p0), 3 * u * u)
      .addScaledVector(new THREE.Vector3().subVectors(p2, p1), 6 * u * t)
      .addScaledVector(new THREE.Vector3().subVectors(p3, p2), 3 * t * t)
      .normalize();
    return { pos, tan };
  };
}

/** Re-parameterize a path to the sub-range [t0, t1]. */
export function pathSub(path: PathFn, t0: number, t1: number): PathFn {
  return (t) => path(t0 + (t1 - t0) * t);
}

const Y_UP = new THREE.Vector3(0, 1, 0);

/** Compute a side/up frame for a tangent, keeping "up" as close to world +Y as possible. */
export function frameFor(tan: THREE.Vector3): { side: THREE.Vector3; up: THREE.Vector3 } {
  const side = new THREE.Vector3().crossVectors(tan, Y_UP);
  if (side.lengthSq() < 1e-8) side.set(0, 0, 1);
  side.normalize();
  const up = new THREE.Vector3().crossVectors(side, tan).normalize();
  return { side, up };
}

/**
 * Sweep a closed profile along a path, producing an indexed BufferGeometry
 * with end caps. Suitable for both rendering and a Rapier trimesh collider.
 */
export function sweep(
  path: PathFn,
  segments: number,
  profile: Profile | ((t: number) => Profile) = TRACK_PROFILE,
  caps = true,
): THREE.BufferGeometry {
  const profileAt = typeof profile === 'function' ? profile : () => profile;
  const n = profileAt(0).length;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const { pos, tan } = path(t);
    const { side, up } = frameFor(tan);
    for (const [s, u] of profileAt(t)) {
      positions.push(
        pos.x + side.x * s + up.x * u,
        pos.y + side.y * s + up.y * u,
        pos.z + side.z * s + up.z * u,
      );
    }
  }
  for (let i = 0; i < segments; i++) {
    const a0 = i * n;
    const b0 = (i + 1) * n;
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      indices.push(a0 + j, b0 + j, b0 + j1);
      indices.push(a0 + j, b0 + j1, a0 + j1);
    }
  }

  if (caps) {
    const last = segments * n;
    for (const [a, b, c] of capTriangles(profileAt(0))) {
      indices.push(a, b, c); // start cap faces -tangent (profile is CCW seen looking along +tangent)
    }
    for (const [a, b, c] of capTriangles(profileAt(1))) {
      indices.push(last + a, last + c, last + b); // end cap faces +tangent
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Straight line from a to b. */
export function linePath(a: THREE.Vector3, b: THREE.Vector3): PathFn {
  const tan = new THREE.Vector3().subVectors(b, a).normalize();
  return (t) => ({ pos: new THREE.Vector3().lerpVectors(a, b, t), tan });
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const dsmooth = (t: number) => 6 * t * (1 - t);

/** Straight in plan, height eased with smoothstep so both ends are level. */
export function slopePath(a: THREE.Vector3, b: THREE.Vector3): PathFn {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dy = b.y - a.y;
  return (t) => {
    const pos = new THREE.Vector3(a.x + dx * t, a.y + dy * smooth(t), a.z + dz * t);
    const tan = new THREE.Vector3(dx, dy * dsmooth(t), dz).normalize();
    return { pos, tan };
  };
}

/**
 * Horizontal circular arc, optionally with a height function.
 * pos = center + (r*sin(th), y(t), -dirSign*r*cos(th)); th from startAngle to endAngle.
 * At th=0 the tangent is +X. dirSign=+1 turns towards +Z (right), -1 towards -Z (left).
 */
export function arcPath(
  center: THREE.Vector3,
  radius: number,
  startAngle: number,
  endAngle: number,
  dirSign: 1 | -1,
  yAt?: (t: number) => { y: number; dy: number },
): PathFn {
  const span = endAngle - startAngle;
  return (t) => {
    const th = startAngle + span * t;
    const y = yAt ? yAt(t).y : 0;
    const dy = yAt ? yAt(t).dy : 0; // dy per unit t
    const pos = new THREE.Vector3(
      center.x + radius * Math.sin(th),
      center.y + y,
      center.z - dirSign * radius * Math.cos(th),
    );
    // d/dt: horizontal part = span * r * (cos th, 0, dirSign*sin th)
    const tan = new THREE.Vector3(span * radius * Math.cos(th), dy, span * dirSign * radius * Math.sin(th));
    tan.normalize();
    return { pos, tan };
  };
}

/** Helix descending by `drop` over `turns` turns, height eased at both ends. */
export function helixPath(
  center: THREE.Vector3,
  radius: number,
  turns: number,
  drop: number,
  dirSign: 1 | -1 = 1,
): PathFn {
  const total = Math.PI * 2 * turns;
  return arcPath(center, radius, 0, total, dirSign, (t) => ({
    y: -drop * smooth(t),
    dy: -drop * dsmooth(t),
  }));
}

/** Merge several indexed geometries into one indexed geometry. */
export function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const idx = g.getIndex();
    if (!idx) throw new Error('mergeGeometries requires indexed geometry');
    for (let i = 0; i < p.count; i++) positions.push(p.getX(i), p.getY(i), p.getZ(i));
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + offset);
    offset += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Axis-aligned box as indexed geometry (for walls, floors). */
export function boxGeo(center: THREE.Vector3, half: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2);
  g.translate(center.x, center.y, center.z);
  return g;
}

/** Extract flat arrays for a Rapier trimesh from an indexed geometry. */
export function trimeshArrays(geo: THREE.BufferGeometry): { vertices: Float32Array; indices: Uint32Array } {
  const p = geo.getAttribute('position');
  const idx = geo.getIndex();
  if (!idx) throw new Error('trimeshArrays requires indexed geometry');
  const vertices = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    vertices[i * 3] = p.getX(i);
    vertices[i * 3 + 1] = p.getY(i);
    vertices[i * 3 + 2] = p.getZ(i);
  }
  const indices = new Uint32Array(idx.count);
  for (let i = 0; i < idx.count; i++) indices[i] = idx.getX(i);
  return { vertices, indices };
}
