import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { boxGeo, linePath, mergeGeometries, slopePath, sweep, sweepStations, trimeshArrays, type Profile, type Station } from '../geometry/sweep';
import { v3, type BuiltPiece, type Mechanism, type MechanismContext, type PieceDef } from './types';

/**
 * Archimedes screw: a helical blade turning inside a fixed tube, carrying marbles up.
 *
 * The axis has to be tilted, not upright. What actually lifts the marble is the pocket between
 * the blade's upper face and the low side of the tube; turning the blade walks that pocket along
 * the axis. Stand the same screw up vertically and there is no low side, so nothing is carried.
 *
 * NOT FINISHED - not in the registry. It builds and looks right, the marble is retained, but it
 * does not climb: it ends up wedged in the first pocket, orbiting with the blade at about 1 m/s
 * while its position never changes. Things already ruled out:
 *   - rotation direction: both ways behave the same
 *   - grip: friction 0.45 and 0.02 (with the Min combine rule) behave the same
 *   - falling out of the bottom mouth: fixed, by capping it and feeding through a top inlet
 *     window instead. A tilted tube's lower mouth faces downwards, so a marble fed in at the end
 *     just drops straight back out.
 * The likely cause is the channel being too tight for a rigid ball: the bore minus the shaft is
 * 0.36 and the marble is 0.30, so instead of resting at the low side of the tube and being pushed
 * along by the blade's face, it gets held between blade, shaft and wall and spun. Water cannot be
 * carried round like that, which is why a real screw does not have this problem. Next thing to
 * try is a much wider bore with a thin or absent shaft, so the marble sits in a trough at the
 * bottom with room to spare.
 */

/** Axis, bottom to top. 40 degrees: shallow enough that the pocket holds a marble. */
const A0 = v3(-0.85, 0.3, 0);
const A1 = v3(2.37, 3, 0);
/**
 * Shaft, blade and bore radii. The channel (bore minus shaft) is 0.53 against a 0.30 marble, so
 * the marble cannot touch the shaft and the wall at once - at 0.36 it could, and it got held
 * between blade, shaft and wall and spun round with the blade instead of climbing. It now rests
 * at the low side of the tube with room to spare and the blade's face pushes it along.
 * Blade to bore is 0.04, far less than the marble, so it can never slip back past a turn.
 */
const SHAFT = 0.05;
const BLADE = 0.54;
const BORE = 0.58;
const WALL = 0.04;
/** Axial rise per turn. Must clear the marble or successive turns pinch it. */
const PITCH = 0.55;
/** Seconds per revolution. One pitch of lift per turn, so this is 0.25 m/s up the axis. */
const PERIOD = 2;
/**
 * A hairline seam along the top of the bore: the section has to stay one closed polygon for
 * `sweep`, and it lets you watch the marble climb. Too narrow for it to escape.
 *
 * Near the bottom it opens into a proper inlet window instead. A tilted tube's lower mouth faces
 * downwards, so a marble fed in at the end just falls straight back out of it - which is what it
 * did. The mouth is capped and the marble is dropped in through the top instead, landing in the
 * first pocket of the blade.
 */
const SEAM = THREE.MathUtils.degToRad(2.5);
const INLET = THREE.MathUtils.degToRad(64);
/** Fraction of the bore's length taken up by the inlet window. A narrow one (46 degrees over the
 *  first 17%) was not forgiving enough: a marble that had queued behind another arrived a little
 *  differently, missed the window and fell past the tube. */
const INLET_END = 0.27;
/**
 * Near the top the seam swings round to the UNDERSIDE and opens out, so the marble simply drops
 * through onto the catch deck. Letting it run out of the end does not work: it leaves the mouth
 * at the 0.3 m/s the blade gives it, which is nowhere near enough to reach anything, and it just
 * falls into the gap under the tube. Turning the screw fast enough to throw it clear would fling
 * it instead.
 */
const OUTLET = THREE.MathUtils.degToRad(52);
const OUTLET_FROM = 0.78;
const OUTLET_OPEN = 0.93;
const RING = 20;

/**
 * How far past A1 the blade and the bore both run. Ending the blade at the mouth left the marble
 * with nothing to push it over the lip and it churned there and slid back; ending it PAST the
 * bore was worse, because outside the tube nothing contains the marble and the blade threw it
 * twenty metres sideways. They have to end together.
 */
const OVERRUN = 0.3;
const AXIS = A1.clone().sub(A0);
const LENGTH = AXIS.length();
const DIR = AXIS.clone().normalize();
const TURNS = LENGTH / PITCH;

const smooth = (t: number) => t * t * (3 - 2 * t);

const IN_PORT = v3(-2.5, 1, 0);
const OUT_PORT = v3(3.5, 2.5, 0);

/** Bore cross-section: an annulus split by a seam at the top, outer ring CCW then inner ring CW,
 *  so the outside faces out and the bore faces the marble. */
function boreProfile(t = 1): Profile {
  const inlet = t >= INLET_END ? SEAM : SEAM + (INLET - SEAM) * (1 - smooth(t / INLET_END));
  const swing = smooth(THREE.MathUtils.clamp((t - OUTLET_FROM) / (OUTLET_OPEN - OUTLET_FROM), 0, 1));
  const gap = Math.max(inlet, SEAM + (OUTLET - SEAM) * swing);
  // Seam centre swings from the top of the bore to the bottom as the outlet opens.
  const centre = Math.PI / 2 - Math.PI * swing;
  const a0 = centre + gap;
  const span = Math.PI * 2 - 2 * gap;
  const pts: Profile = [];
  for (let i = 0; i <= RING; i++) {
    const th = a0 + (span * i) / RING;
    pts.push([(BORE + WALL) * Math.cos(th), (BORE + WALL) * Math.sin(th)]);
  }
  for (let i = RING; i >= 0; i--) {
    const th = a0 + (span * i) / RING;
    pts.push([BORE * Math.cos(th), BORE * Math.sin(th)]);
  }
  return pts;
}

/**
 * The blade: a thin ribbon sweeping radially outward from the shaft, following a helix around the
 * axis. Stations sit on the shaft surface with `side` pointing radially out, so the profile - a
 * flat rectangle - lays the blade out along the radius.
 */
function bladeStations(): Station[] {
  const stations: Station[] = [];
  // A frame around the axis to turn an angle into a radial direction.
  const ref = Math.abs(DIR.y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(ref, DIR).normalize();
  const w = new THREE.Vector3().crossVectors(DIR, u).normalize();
  const total = LENGTH + OVERRUN;
  const steps = Math.round((total / PITCH) * 24);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (total / LENGTH);
    const ang = t * TURNS * Math.PI * 2;
    const radial = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(w, Math.sin(ang));
    const pos = A0.clone().addScaledVector(DIR, t * LENGTH).addScaledVector(radial, SHAFT);
    // Travel direction along the helix: along the axis plus the circumferential part.
    const circ = u.clone().multiplyScalar(-Math.sin(ang)).addScaledVector(w, Math.cos(ang));
    const tan = DIR.clone().multiplyScalar(LENGTH).addScaledVector(circ, TURNS * Math.PI * 2 * SHAFT).normalize();
    const side = radial.clone().addScaledVector(tan, -radial.dot(tan)).normalize();
    const up = new THREE.Vector3().crossVectors(side, tan).normalize();
    stations.push({ pos, side, up });
  }
  return stations;
}

/** Flat rectangle: from the shaft out to the blade rim, 3 cm thick. CCW in (side, up). */
const BLADE_PROFILE: Profile = [
  [0, 0.015],
  [0, -0.015],
  [BLADE - SHAFT, -0.015],
  [BLADE - SHAFT, 0.015],
];

function bladeGeometry(): THREE.BufferGeometry {
  return sweepStations(bladeStations(), BLADE_PROFILE);
}

function shaftGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(SHAFT, SHAFT, LENGTH, 16);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), DIR));
  g.translate(A0.x + AXIS.x / 2, A0.y + AXIS.y / 2, A0.z + AXIS.z / 2);
  return g;
}

export const screwDef: PieceDef = {
  id: 'screw',
  name: '螺旋提升机',
  footprint: [-2, -1, 0, 1, 2, 3].map((x) => ({ x, z: 0 })),
  heightUnits: 8,
  ports: [
    { pos: IN_PORT, dir: v3(-1, 0, 0), kind: 'in' },
    { pos: OUT_PORT, dir: v3(1, 0, 0), kind: 'out' },
  ],
  build(): BuiltPiece {
    // Lead-in to the bottom of the bore, and a catch deck under the top of it.
    // The bore's mouth is a tilted disc, so the deck has to stop clear of the whole rim and let
    // the marble fly horizontally through the hole - ending "just before A0" put the deck inside
    // the tube's wall, and the marble stopped dead against it.
    // Runs to just short of the inlet window and drops the marble in through the top of the bore.
    const feed = sweep(slopePath(IN_PORT, v3(A0.x - 0.35, A0.y + 0.5, 0)), 14);
    const exit = sweep(slopePath(v3(A1.x - 0.35, A1.y - 0.5, 0), OUT_PORT), 18);
    const bore = sweep(linePath(A0.clone().addScaledVector(DIR, -0.15), A1.clone().addScaledVector(DIR, OVERRUN)), 96, boreProfile);
    // Cap over the lower mouth, which otherwise faces down and lets everything fall out again.
    const capQ = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), DIR);
    const cap = new THREE.CylinderGeometry(BORE + WALL, BORE + WALL, 0.04, 24);
    cap.applyQuaternion(capQ);
    const capAt = A0.clone().addScaledVector(DIR, -0.16);
    cap.translate(capAt.x, capAt.y, capAt.z);
    const legs = mergeGeometries([
      boxGeo(v3(A0.x + 0.25, (A0.y - 0.3) / 2, 0.55), v3(0.04, Math.max(0.1, (A0.y + 0.3) / 2), 0.04)),
      boxGeo(v3(A1.x - 0.3, A1.y / 2, 0.55), v3(0.04, A1.y / 2, 0.04)),
    ]);
    return {
      parts: [
        { geometry: feed, material: 'wood' },
        { geometry: exit, material: 'wood' },
        { geometry: bore, material: 'glass' },
        { geometry: cap, material: 'glass' },
        { geometry: legs, material: 'dark', collide: false },
      ],
      preview: [
        { geometry: bladeGeometry(), material: 'accent' },
        { geometry: shaftGeometry(), material: 'dark' },
      ],
      mechanisms: [makeScrew],
    };
  },
};

function makeScrew(ctx: MechanismContext): Mechanism {
  // The body sits on the axis and spins about it, so build the geometry relative to A0.
  const origin = A0.clone().applyQuaternion(ctx.quat).add(ctx.origin);
  const body = ctx.world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(origin.x, origin.y, origin.z).setRotation(ctx.quat),
  );
  const blade = bladeGeometry();
  const shaft = shaftGeometry();
  blade.translate(-A0.x, -A0.y, -A0.z);
  shaft.translate(-A0.x, -A0.y, -A0.z);
  // Slick on purpose. Friction is what drags a marble round with the blade instead of letting it
  // sit at the low side of the tube while the blade's face pushes it along the axis - with grip it
  // just orbited in the first pocket and never climbed. Water cannot be carried round like that,
  // which is why a real screw does not need this.
  const grip = (d: RAPIER.ColliderDesc) =>
    d.setFriction(0.02).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(0).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min);
  const tri = trimeshArrays(blade);
  ctx.world.createCollider(grip(RAPIER.ColliderDesc.trimesh(tri.vertices, tri.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)), body);
  const mid = DIR.clone().multiplyScalar(LENGTH / 2);
  ctx.world.createCollider(
    grip(
      RAPIER.ColliderDesc.cylinder(LENGTH / 2, SHAFT)
        .setTranslation(mid.x, mid.y, mid.z)
        .setRotation(new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), DIR)),
    ),
    body,
  );

  const mesh = new THREE.Mesh(mergeGeometries([blade, shaft]), new THREE.MeshStandardMaterial({ color: 0xd0703a, roughness: 0.6 }));
  mesh.castShadow = true;
  ctx.root.add(mesh);
  ctx.bind(body, mesh);

  let angle = 0;
  const q = new THREE.Quaternion();
  const axisWorld = DIR.clone();
  return {
    update(dt) {
      angle -= ((Math.PI * 2) / PERIOD) * dt;
      q.setFromAxisAngle(axisWorld, angle).premultiply(ctx.quat);
      body.setNextKinematicRotation(q);
    },
    dispose() {
      ctx.unbind(body);
      ctx.world.removeRigidBody(body);
      ctx.root.remove(mesh);
      mesh.geometry.dispose();
    },
  };
}
