import * as THREE from 'three';
import { frameFor, sweepStations, type Station } from '../geometry/sweep';
import { v3, type PieceDef } from './types';

/** Centre-line radius of the loop. */
const R = 0.6;
/**
 * A rolling sphere needs 2.7 x the radius of drop above the loop's floor to stay on the track at
 * the top - 1.62 m here. The piece supplies that itself rather than relying on what is in front
 * of it: too slow and the marble comes off the top and settles in the dip at the loop's foot,
 * where the track rises in both directions and it can never get out. The ramp below gives 2.15 m,
 * so the entry speed does not depend on the rest of the track at all.
 */
const IN = v3(-0.5, 2.5, 0);
const FLOOR = v3(3, 0.35, 0);
const CENTRE = v3(FLOOR.x, FLOOR.y + R, 0);
const OUT = v3(4.5, 0, 1);
/**
 * The loop drifts one cell sideways as it goes round. A planar loop would bring its exit back
 * through its own entry, and two decks in one collider bump the marble along the boundary edges
 * between them; it also lets the entry ramp pass through the loop without touching it.
 */
const DRIFT = 1;

const smooth = (t: number) => t * t * (3 - 2 * t);
const dsmooth = (t: number) => 6 * t * (1 - t);

/** A straight run in plan whose height eases in and out, so both ends are level. */
function rampStations(from: THREE.Vector3, to: THREE.Vector3, n: number, skipFirst = false): Station[] {
  const out: Station[] = [];
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const t = i / n;
    const pos = v3(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * smooth(t), from.z + (to.z - from.z) * t);
    const tan = v3(to.x - from.x, (to.y - from.y) * dsmooth(t), to.z - from.z).normalize();
    out.push({ pos, ...frameFor(tan) });
  }
  return out;
}

/**
 * One continuous station list - entry ramp, loop, exit ramp - so it is a single sweep with no
 * seams and one collider. Built by hand rather than from a PathFn because the frame has to roll
 * with the loop: `frameFor` keeps "up" near world +Y, which would leave the trough facing the sky
 * at the top of the loop instead of towards the marble.
 */
function loopStations(): Station[] {
  const stations = rampStations(IN, FLOOR, 20);

  const SEG = 80;
  for (let i = 1; i <= SEG; i++) {
    const t = i / SEG;
    const phi = (270 + 360 * t) * (Math.PI / 180);
    const pos = v3(CENTRE.x + R * Math.cos(phi), CENTRE.y + R * Math.sin(phi), DRIFT * smooth(t));
    // Circle tangent plus the sideways drift. The drift is eased, so it is zero at both ends and
    // the joins with the straight ramps have no kink.
    const tan = v3(-Math.sin(phi) * 2 * Math.PI, Math.cos(phi) * 2 * Math.PI, (DRIFT * dsmooth(t)) / R).normalize();
    // Up points at the centre of the loop, so the trough always faces the marble.
    const up = v3(-Math.cos(phi), -Math.sin(phi), 0);
    up.addScaledVector(tan, -up.dot(tan)).normalize();
    const side = new THREE.Vector3().crossVectors(tan, up).normalize();
    stations.push({ pos, side, up });
  }

  stations.push(...rampStations(v3(FLOOR.x, FLOOR.y, DRIFT), OUT, 12, true));
  return stations;
}

/**
 * Loop the loop: the marble runs down a long ramp, round a vertical circle and out one cell over.
 * No mechanism - it goes round on its own speed, which the piece's own ramp guarantees.
 */
export const loopDef: PieceDef = {
  id: 'loop',
  name: '环形轨道',
  footprint: [0, 1, 2, 3, 4].flatMap((x) => [0, 1].map((z) => ({ x, z }))),
  heightUnits: 5,
  ports: [
    { pos: IN, dir: v3(-1, 0, 0), kind: 'in' },
    { pos: OUT, dir: v3(1, 0, 0), kind: 'out' },
  ],
  build() {
    return { parts: [{ geometry: sweepStations(loopStations()), material: 'wood' }] };
  },
};
