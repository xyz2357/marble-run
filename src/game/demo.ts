import { ChainBuilder, type Track } from './track';

/** Stage 1 demo: a hand-chained track exercising every basic piece type. */
export function buildDemoTrack(track: Track): void {
  const b = new ChainBuilder(track);
  b.begin({ def: 'start', cell: { x: -6, z: 0 }, level: 12, rot: 0 })
    .add('slope')
    .add('straight')
    .add('curve_r')
    .add('slope')
    .add('curve_l')
    .add('helix')
    .add('slope')
    .add('straight')
    .add('bigcurve_r')
    .add('slope_steep')
    .add('funnel')
    .add('straight')
    .add('slope')
    .add('end');
}

/** Demo 2: mechanisms. Lift -> xylophone -> seesaw -> gate -> splitter -> two ends, plus a vortex on one branch. */
export function buildMechanismDemo(track: Track): void {
  const b = new ChainBuilder(track);
  b.begin({ def: 'start', cell: { x: -3, z: 0 }, level: 1, rot: 0 })
    .add('slope_steep')
    .add('lift10')
    .add('xylophone')
    .add('seesaw')
    .add('gate')
    .add('splitter', { exitPort: 1 })
    .add('bigcurve_r')
    .add('slope')
    .add('vortex')
    .add('end');
  // Second branch from the splitter's other exit.
  const splitter = track.pieces.find((p) => p.placed.def === 'splitter')!;
  b.from(splitter, 2).add('slope').add('slope').add('curve_l').add('end');
}
