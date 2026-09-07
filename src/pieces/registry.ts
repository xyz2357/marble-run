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
import { jumpDef } from './jump';
import { helixDef } from './helix';
import { liftDef } from './lift';
import { loopDef } from './loop';
import { seesawDef } from './seesaw';
import { sCurveLeftDef, sCurveRightDef } from './scurve';
import { mergeDef, splitterDef, splitterRandomDef } from './splitter';
import { brakeDef, iceDef } from './surface';
import { tubeDef, tubeSlopeDef } from './tube';
import { wheelDef } from './wheel';
import { vortexDef } from './vortex';
import { xylophoneDef } from './xylophone';
import type { PieceDef } from './types';

/** All pieces. Family members sit next to each other; the first of a family is its palette entry. */
const defs: PieceDef[] = [
  startDef,
  straightDef,
  slopeDef,
  slopeSteepDef,
  curveRightDef,
  curveLeftDef,
  bigCurveRightDef,
  bigCurveLeftDef,
  sCurveRightDef,
  sCurveLeftDef,
  helixDef(1),
  helixDef(2),
  helixDef(3),
  funnelDef,
  endDef,
  // Palette entries after the 12th have no hotkey.
  vortexDef,
  splitterDef,
  splitterRandomDef,
  mergeDef,
  seesawDef,
  // Each lift height twice: glass shaft and solid shaft, paired so V toggles the finish first.
  liftDef(4),
  liftDef(4, true),
  liftDef(6),
  liftDef(6, true),
  liftDef(8),
  liftDef(8, true),
  liftDef(10),
  liftDef(10, true),
  loopDef,
  gateDef(1.5),
  gateDef(3),
  gateDef(5),
  iceDef,
  brakeDef,
  tubeDef,
  tubeSlopeDef,
  xylophoneDef,
  jumpDef,
  wheelDef(5),
  wheelDef(2.5),
  wheelDef(7, 8),
];

export const PIECES: ReadonlyMap<string, PieceDef> = new Map(defs.map((d) => [d.id, d]));

const palette: PieceDef[] = defs.filter((d, i) => !d.family || defs.findIndex((o) => o.family?.id === d.family!.id) === i);

/** One entry per family (its first member) plus every family-less piece, in palette order. */
export function paletteDefs(): PieceDef[] {
  return palette;
}

/** The members of a piece's family (just the piece itself when it has none). */
export function variantsOf(def: PieceDef): PieceDef[] {
  if (!def.family) return [def];
  return defs.filter((d) => d.family?.id === def.family!.id);
}

/** Same piece, or members of the same family. */
export function sameFamily(a: PieceDef | null | undefined, b: PieceDef | null | undefined): boolean {
  if (!a || !b) return false;
  return a.id === b.id || (!!a.family && a.family.id === b.family?.id);
}

export function getPiece(id: string): PieceDef {
  const d = PIECES.get(id);
  if (!d) throw new Error(`Unknown piece: ${id}`);
  return d;
}

export function listPieces(): PieceDef[] {
  return defs;
}
