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
import { gateDef } from './gate';
import { helixDef } from './helix';
import { liftDef } from './lift';
import { seesawDef } from './seesaw';
import { mergeDef, splitterDef } from './splitter';
import { vortexDef } from './vortex';
import { xylophoneDef } from './xylophone';
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
  // Pieces after the 12th have no palette hotkey.
  vortexDef,
  splitterDef,
  mergeDef,
  seesawDef,
  liftDef(6),
  liftDef(10),
  gateDef,
  xylophoneDef,
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
