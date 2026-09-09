import * as THREE from 'three';

/** Path sample: position and unit tangent at parameter t in [0,1]. */
export type PathFn = (t: number) => { pos: THREE.Vector3; tan: THREE.Vector3 };

/** Closed 2D profile in (side, up) coordinates, counter-clockwise. */
export type Profile = [number, number][];

export const TRACK_HALF_WIDTH = 0.36;
export const RAIL_HEIGHT = 0.22;
/** Radius of the trough's circular floor; the marble (r = 0.15) self-centres in it. */
export const TROUGH_RADIUS = 0.45;
/** Half-width of the trough opening (inner faces of the rails). */
export const TROUGH_HALF = 0.3;

/** Height of the trough floor at lateral offset s (0 at the centre, rising towards the rails). */
export function troughY(s: number): number {
  const c = Math.min(Math.abs(s), TROUGH_HALF);
  return TROUGH_RADIUS - Math.sqrt(TROUGH_RADIUS * TROUGH_RADIUS - c * c);
}

/** Lateral sample positions of the trough floor, from +TROUGH_HALF to -TROUGH_HALF. */
export const TROUGH_SAMPLES = [0.3, 0.225, 0.15, 0.075, 0, -0.075, -0.15, -0.225, -0.3];

/**
 * Standard track profile: a rounded trough (circular arc, radius 0.45) between
 * two rails. Deck top is at u = 0 in the centre, the base 0.08 below. Closed, CCW.
 */
export const TRACK_PROFILE: Profile = [
  [-TRACK_HALF_WIDTH, RAIL_HEIGHT],
  [-TRACK_HALF_WIDTH, -0.08],
  [TRACK_HALF_WIDTH, -0.08],
  [TRACK_HALF_WIDTH, RAIL_HEIGHT],
  [TROUGH_HALF, RAIL_HEIGHT],
  ...TROUGH_SAMPLES.map((s) => [s, troughY(s)] as [number, number]),
  [-TROUGH_HALF, RAIL_HEIGHT],
];

const Y_UP = new THREE.Vector3(0, 1, 0);

/** Compute a side/up frame for a tangent, keeping "up" as close to world +Y as possible. */
export function frameFor(tan: THREE.Vector3): { side: THREE.Vector3; up: THREE.Vector3 } {
  const side = new THREE.Vector3().crossVectors(tan, Y_UP);
  if (side.lengthSq() < 1e-8) side.set(0, 0, 1);
  side.normalize();
  const up = new THREE.Vector3().crossVectors(side, tan).normalize();
  return { side, up };
}

/** One station of a sweep: position plus the (side, up) frame the profile is laid out in. */
export interface Station {
  pos: THREE.Vector3;
  side: THREE.Vector3;
  up: THREE.Vector3;
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
  return sweepStations(pathStations(path, segments), profile, caps);
}

/** The frames `sweep` would use: one per station, evenly spaced along the path. */
export function pathStations(path: PathFn, segments: number): Station[] {
  const stations: Station[] = [];
  for (let i = 0; i <= segments; i++) {
    const { pos, tan } = path(i / segments);
    const { side, up } = frameFor(tan);
    stations.push({ pos, side, up });
  }
  return stations;
}

/** A section of a walled tube: bore radius, outside radius, and the bore's centre height. */
export type TubeSection = { rIn: number; rOut: number; centre: number };

/**
 * A tube with a wall and no seam anywhere. One swept profile cannot describe an annulus - it is
 * a closed loop, so the ring has to be cut open somewhere to get from the outside to the bore, and
 * however fine that cut is you can see it: at 2.5 degrees it is a 15 mm slot along the top, and
 * closing it to nothing leaves a zero-width sliver of coincident faces that shows up just as badly.
 * So the wall is two sweeps, each a closed ring on its own, with a flat annulus across each end.
 */
export function tubeShell(
  path: PathFn,
  segments: number,
  section: (t: number) => TubeSection,
  ring = 24,
): THREE.BufferGeometry {
  const circle = (r: number, centre: number, reverse: boolean): Profile => {
    const pts: Profile = [];
    for (let i = 0; i < ring; i++) {
      const th = (Math.PI * 2 * i) / ring;
      pts.push([r * Math.cos(th), centre + r * Math.sin(th)]);
    }
    return reverse ? pts.reverse() : pts;
  };
  const stations = pathStations(path, segments);
  const outer = sweepStations(stations, (t) => { const s = section(t); return circle(s.rOut, s.centre, false); }, false);
  const inner = sweepStations(stations, (t) => { const s = section(t); return circle(s.rIn, s.centre, true); }, false);

  // Flat ring across each mouth. The start faces back down the path, the end faces along it, which
  // is the winding each one needs for its normal to point out of the solid.
  const rings: THREE.BufferGeometry[] = [];
  for (const at of [0, 1] as const) {
    const st = stations[at === 0 ? 0 : stations.length - 1];
    const s = section(at);
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < ring; i++) {
      const th = (Math.PI * 2 * i) / ring;
      for (const r of [s.rIn, s.rOut]) {
        const u = r * Math.cos(th);
        const v = s.centre + r * Math.sin(th);
        pos.push(st.pos.x + st.side.x * u + st.up.x * v, st.pos.y + st.side.y * u + st.up.y * v, st.pos.z + st.side.z * u + st.up.z * v);
      }
    }
    for (let i = 0; i < ring; i++) {
      const a = i * 2;
      const b = ((i + 1) % ring) * 2;
      if (at === 0) idx.push(a, a + 1, b + 1, a, b + 1, b);
      else idx.push(a, b + 1, a + 1, a, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    rings.push(g);
  }
  return mergeGeometries([outer, inner, ...rings]);
}

/**
 * Sweep a closed CCW profile through explicit stations. The frame convention is the
 * one `frameFor` produces: side x up = -tangent (for a +X path: side = +Z, up = +Y),
 * so callers laying out their own frames must keep that handedness or the
 * triangles come out inward-facing.
 */
export function sweepStations(stations: Station[], profile: Profile | ((t: number) => Profile) = TRACK_PROFILE, caps = true): THREE.BufferGeometry {
  const segments = stations.length - 1;
  const profileAt = typeof profile === 'function' ? profile : () => profile;
  const n = profileAt(0).length;
  const positions: number[] = [];
  const indices: number[] = [];
  // UVs in metres: u runs along the path, v across the section. Textures can then tile at a real
  // size (one wood tile per metre) whatever the segment count, and the grain follows the track.
  const uvs: number[] = [];
  let along = 0;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const { pos, side, up } = stations[i];
    if (i > 0) along += pos.distanceTo(stations[i - 1].pos);
    const ring = profileAt(t);
    let across = 0;
    for (let j = 0; j < ring.length; j++) {
      const [s, u] = ring[j];
      if (j > 0) across += Math.hypot(s - ring[j - 1][0], u - ring[j - 1][1]);
      positions.push(
        pos.x + side.x * s + up.x * u,
        pos.y + side.y * s + up.y * u,
        pos.z + side.z * s + up.z * u,
      );
      uvs.push(along, across);
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
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Arc-shaped shell in the XY plane (a casing around a wheel with its axle along Z):
 * radii rIn..rOut, z in [-halfZ, halfZ], from angle a0 to a1 (radians, CCW from +X).
 * Outward-facing regardless of the angle order.
 */
export function ringShell(center: THREE.Vector3, rIn: number, rOut: number, halfZ: number, a0: number, a1: number, segments: number): THREE.BufferGeometry {
  // Frame handedness (see sweepStations): with side = +Z and up = radial, the tangent must be
  // -theta_hat, i.e. the stations must run in DEcreasing angle.
  const from = Math.max(a0, a1);
  const to = Math.min(a0, a1);
  const stations: Station[] = [];
  for (let i = 0; i <= segments; i++) {
    const th = from + ((to - from) * i) / segments;
    stations.push({
      pos: center.clone(),
      side: new THREE.Vector3(0, 0, 1),
      up: new THREE.Vector3(Math.cos(th), Math.sin(th), 0),
    });
  }
  const profile: Profile = [
    [-halfZ, rOut],
    [-halfZ, rIn],
    [halfZ, rIn],
    [halfZ, rOut],
  ];
  return sweepStations(stations, profile, true);
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
  const uvs: number[] = [];
  let offset = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const idx = g.getIndex();
    if (!idx) throw new Error('mergeGeometries requires indexed geometry');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      // BoxGeometry brings 0..1 UVs per face; anything without them gets a flat corner.
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + offset);
    offset += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Rescale a geometry's 0..1 UVs into metres, so a texture tiled once per metre reads at the same
 * size on it as on a swept track. Three's own primitives (box, lathe) map each face or one whole
 * revolution to 0..1, which with a metre-scale wood grain smears one tile across the entire
 * surface - the vortex bowl came out as a set of concentric rings.
 */
export function metreUV(geo: THREE.BufferGeometry, uMetres: number, vMetres: number): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv');
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uMetres, uv.getY(i) * vMetres);
  uv.needsUpdate = true;
  return geo;
}

/**
 * Metre-scale UVs for a revolved profile: u around the circumference (at the widest radius, so the
 * grain runs a touch tighter further in, the way a turned bowl actually looks), v along the profile.
 */
export function latheUV(geo: THREE.BufferGeometry, pts: THREE.Vector2[], phiLength = Math.PI * 2): THREE.BufferGeometry {
  let maxR = 0;
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    maxR = Math.max(maxR, pts[i].x);
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
  }
  return metreUV(geo, maxR * phiLength, len);
}

/** Axis-aligned box as indexed geometry (for walls, floors). */
export function boxGeo(center: THREE.Vector3, half: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2);
  const dims = [half.x * 2, half.y * 2, half.z * 2].sort((a, b) => b - a);
  metreUV(g, dims[0], dims[1]);
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
