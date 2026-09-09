import * as THREE from 'three';
import { arcPath, boxGeo, linePath, mergeGeometries, slopePath, sweep, RAIL_HEIGHT, TRACK_HALF_WIDTH } from '../geometry/sweep';
import { H, v3, type PieceDef } from './types';

const PX = v3(1, 0, 0);
const NX = v3(-1, 0, 0);
const PZ = v3(0, 0, 1);
const NZ = v3(0, 0, -1);

/** Start: a short launch ramp with a back wall; marble spawns at the high end. Exit +X. */
export const startDef: PieceDef = {
  id: 'start',
  name: '起点',
  footprint: [{ x: 0, z: 0 }],
  heightUnits: 1,
  ports: [{ pos: v3(0.5, 0, 0), dir: PX, kind: 'out' }],
  build() {
    const rise = 0.3;
    const track = sweep(slopePath(v3(-0.5, rise, 0), v3(0.5, 0, 0)), 12);
    const wall = boxGeo(v3(-0.47, rise + 0.15, 0), v3(0.03, 0.23, TRACK_HALF_WIDTH));
    return {
      parts: [
        { geometry: track, material: 'wood' },
        { geometry: wall, material: 'accent' },
      ],
      spawn: v3(-0.3, rise + 0.17, 0),
    };
  },
};

export const straightDef: PieceDef = {
  id: 'straight',
  name: '直道',
  footprint: [{ x: 0, z: 0 }],
  heightUnits: 1,
  ports: [
    { pos: v3(-0.5, 0, 0), dir: NX, kind: 'both' },
    { pos: v3(0.5, 0, 0), dir: PX, kind: 'both' },
  ],
  build() {
    return { parts: [{ geometry: sweep(linePath(v3(-0.5, 0, 0), v3(0.5, 0, 0)), 1), material: 'wood' }] };
  },
};

/** Slope: 2 cells long, drops one level (H). Entry high at -X, exit low at +X. */
export const slopeDef: PieceDef = {
  id: 'slope',
  name: '斜道',
  footprint: [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
  ],
  heightUnits: 2,
  ports: [
    { pos: v3(-0.5, H, 0), dir: NX, kind: 'in' },
    { pos: v3(1.5, 0, 0), dir: PX, kind: 'out' },
  ],
  build() {
    return { parts: [{ geometry: sweep(slopePath(v3(-0.5, H, 0), v3(1.5, 0, 0)), 24), material: 'wood' }] };
  },
};

/**
 * Steep slope, `cells` long and dropping one level per cell: the same 27 degree average whatever
 * length you pick.
 *
 * Length is a variant rather than something you get by chaining, because chaining is exactly what
 * hurts. `slopePath` eases the height with a smoothstep, so a slope is LEVEL at both ends - right
 * when it meets a flat piece, but it means a run made of N one-cell slopes is a washboard with a
 * crest every metre. A marble holds the deck over a crest only while v^2 * |y''| <= g, and a
 * one-cell steep has y'' = 3, so anything past 1.8 m/s leaves the deck at the top of every single
 * one. It lands back in a round trough slightly off centre, which turns a little of the fall into
 * sideways speed - measured at 1.83 m/s from one contact - and after a dozen of them the marble is
 * out of the track altogether: 7 m off to the side, and dragged up to 11 m/s on the way.
 *
 * One long piece has the same drop spread over its whole length, so y'' falls as 1/cells - 3.0,
 * 1.5, 1.0, 0.75 for one to four cells, or 1.8, 2.6, 3.1 and 3.6 m/s before it leaves the deck -
 * and there are no joints inside it to leave at all.
 *
 * The cost is occupancy: a piece claims a box, so a 4-cell steep reserves 4 cells over 5 levels
 * rather than the diagonal it actually fills, and you cannot run track under its lower end.
 */
export function slopeSteepDef(cells: number): PieceDef {
  return {
    id: cells === 1 ? 'slope_steep' : `slope_steep${cells}`,
    name: cells === 1 ? '陡坡' : `陡坡 ${cells} 格`,
    family: { id: 'slope_steep', label: `${cells} 格` },
    footprint: Array.from({ length: cells }, (_, x) => ({ x, z: 0 })),
    heightUnits: cells + 1,
    ports: [
      { pos: v3(-0.5, cells * H, 0), dir: NX, kind: 'in' },
      { pos: v3(cells - 0.5, 0, 0), dir: PX, kind: 'out' },
    ],
    build() {
      return {
        parts: [
          { geometry: sweep(slopePath(v3(-0.5, cells * H, 0), v3(cells - 0.5, 0, 0)), 16 * cells), material: 'wood' },
        ],
      };
    },
  };
}

function curveDef(id: string, name: string, dirSign: 1 | -1): PieceDef {
  // Quarter arc of radius 0.5 inside one cell. Enter at -X edge heading +X, exit at +/-Z edge.
  const exitDir = dirSign === 1 ? PZ : NZ;
  return {
    id,
    name,
    footprint: [{ x: 0, z: 0 }],
    heightUnits: 1,
    ports: [
      { pos: v3(-0.5, 0, 0), dir: NX, kind: 'both' },
      { pos: v3(0, 0, 0.5 * dirSign), dir: exitDir, kind: 'both' },
    ],
    build() {
      const center = v3(-0.5, 0, 0.5 * dirSign);
      return { parts: [{ geometry: sweep(arcPath(center, 0.5, 0, Math.PI / 2, dirSign), 12), material: 'wood' }] };
    },
  };
}

export const curveRightDef = curveDef('curve_r', '右弯', 1);
export const curveLeftDef = curveDef('curve_l', '左弯', -1);

function bigCurveDef(id: string, name: string, dirSign: 1 | -1): PieceDef {
  // Quarter arc of radius 1.5 over a 2x2 block. Anchor is the (-X, -Z) cell for right turns.
  // Enter at (-0.5, 0, 0) heading +X; exit at (1, 0, 1.5*dirSign) heading +/-Z.
  const exitDir = dirSign === 1 ? PZ : NZ;
  return {
    id,
    name,
    footprint: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 0, z: dirSign },
      { x: 1, z: dirSign },
    ],
    heightUnits: 1,
    ports: [
      { pos: v3(-0.5, 0, 0), dir: NX, kind: 'both' },
      { pos: v3(1, 0, 1.5 * dirSign), dir: exitDir, kind: 'both' },
    ],
    build() {
      const center = v3(-0.5, 0, 1.5 * dirSign);
      return { parts: [{ geometry: sweep(arcPath(center, 1.5, 0, Math.PI / 2, dirSign), 24), material: 'wood' }] };
    },
  };
}

export const bigCurveRightDef = bigCurveDef('bigcurve_r', '大右弯', 1);
export const bigCurveLeftDef = bigCurveDef('bigcurve_l', '大左弯', -1);

/** End: a catch box. Floor is one step below the incoming track so marbles cannot roll back out. */
export const endDef: PieceDef = {
  id: 'end',
  name: '终点',
  footprint: [{ x: 0, z: 0 }],
  heightUnits: 1,
  ports: [{ pos: v3(-0.5, 0, 0), dir: NX, kind: 'in' }],
  build() {
    const floorY = -0.2;
    const wallTop = 0.25;
    const hw = 0.5;
    const floor = boxGeo(v3(0, floorY - 0.04, 0), v3(hw, 0.04, hw));
    const back = boxGeo(v3(hw - 0.03, (floorY + wallTop) / 2, 0), v3(0.03, (wallTop - floorY) / 2, hw));
    const sideA = boxGeo(v3(0, (floorY + wallTop) / 2, hw - 0.03), v3(hw, (wallTop - floorY) / 2, 0.03));
    const sideB = boxGeo(v3(0, (floorY + wallTop) / 2, -(hw - 0.03)), v3(hw, (wallTop - floorY) / 2, 0.03));
    // Front lip: from floor up to the incoming deck height (0), so marbles drop in and stay.
    const front = boxGeo(v3(-hw + 0.03, (floorY + 0) / 2, 0), v3(0.03, (0 - floorY) / 2, hw));
    const walls = mergeGeometries([back, sideA, sideB, front]);
    const flag = boxGeo(v3(hw - 0.1, wallTop + 0.25, 0), v3(0.02, 0.25, 0.02));
    const flagCloth = boxGeo(v3(hw - 0.1 - 0.12, wallTop + 0.42, 0), v3(0.1, 0.07, 0.005));
    return {
      parts: [
        { geometry: floor, material: 'dark' },
        { geometry: walls, material: 'wood' },
        { geometry: flag, material: 'dark', collide: false },
        { geometry: flagCloth, material: 'goal', collide: false },
      ],
      goal: { center: v3(0, floorY + 0.2, 0), half: v3(hw - 0.06, 0.3, hw - 0.06) },
    };
  },
};

export { RAIL_HEIGHT };
