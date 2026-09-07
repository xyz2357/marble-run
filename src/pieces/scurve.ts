import { bezierPath, sweep } from '../geometry/sweep';
import { v3, type PieceDef } from './types';

const PX = v3(1, 0, 0);
const NX = v3(-1, 0, 0);

/**
 * S bend: a lane change over a 2x2 block. Enter at the -X edge of the anchor cell heading
 * +X, leave one cell to the side still heading +X. A cubic Bezier with both control points
 * on the mid plane makes the tangent axial at both ends, so it butts up against straights
 * and slopes without a kink; the steepest heading is 45 degrees at the inflection, where the
 * curvature is zero.
 */
function sCurveDef(id: string, name: string, label: string, dirSign: 1 | -1): PieceDef {
  const z = 1 * dirSign;
  return {
    id,
    name,
    family: { id: 'scurve', label },
    footprint: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 0, z: dirSign },
      { x: 1, z: dirSign },
    ],
    heightUnits: 1,
    ports: [
      { pos: v3(-0.5, 0, 0), dir: NX, kind: 'both' },
      { pos: v3(1.5, 0, z), dir: PX, kind: 'both' },
    ],
    build() {
      const path = bezierPath(v3(-0.5, 0, 0), v3(0.5, 0, 0), v3(0.5, 0, z), v3(1.5, 0, z));
      return { parts: [{ geometry: sweep(path, 28), material: 'wood' }] };
    },
  };
}

export const sCurveRightDef = sCurveDef('scurve_r', 'S 弯（右）', '右', 1);
export const sCurveLeftDef = sCurveDef('scurve_l', 'S 弯（左）', '左', -1);
