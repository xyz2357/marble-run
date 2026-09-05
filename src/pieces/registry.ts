import {
  bigCurveLeftDef,
  bigCurveRightDef,
  curveLeftDef,
  curveRightDef,
  endDef,
  slopeDef,
  slopeSteepDef,
  startDef,
  straightDef,
} from './basic';
import { funnelDef } from './funnel';
import { helixDef } from './helix';
import type { PieceDef } from './types';

const defs: PieceDef[] = [
  startDef,
  straightDef,
  slopeDef,
  slopeSteepDef,
  curveRightDef,
  curveLeftDef,
  bigCurveRightDef,
  bigCurveLeftDef,
  helixDef(1),
  helixDef(2),
  funnelDef,
  endDef,
];

export const PIECES: ReadonlyMap<string, PieceDef> = new Map(defs.map((d) => [d.id, d]));

export function getPiece(id: string): PieceDef {
  const d = PIECES.get(id);
  if (!d) throw new Error(`Unknown piece: ${id}`);
  return d;
}

export function listPieces(): PieceDef[] {
  return defs;
}
