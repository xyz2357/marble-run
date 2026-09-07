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
  // Level 2, not 1: the lift's shaft hangs one level below its anchor (see liftDef.depthUnits).
  b.begin({ def: 'start', cell: { x: -3, z: 0 }, level: 2, rot: 0 })
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

/** Demo 3: triple helix -> spring jump -> water wheel -> random splitter -> two ends. */
export function buildJumpDemo(track: Track): void {
  const b = new ChainBuilder(track);
  // Marbles leave the wheel slowly, so both branches after the splitter keep descending.
  b.begin({ def: 'start', cell: { x: -6, z: 0 }, level: 16, rot: 0 })
    .add('slope_steep')
    .add('helix3')
    .add('jump')
    .add('slope_steep')
    .add('wheel')
    .add('splitter_rnd', { exitPort: 1 })
    .add('bigcurve_r')
    .add('slope')
    .add('end');
  const splitter = track.pieces.find((p) => p.placed.def === 'splitter_rnd')!;
  b.from(splitter, 2).add('curve_l').add('slope').add('end');
}

/** Demo 4: the S bends and the slit tubes, weaving sideways as it descends. */
export function buildTubeDemo(track: Track): void {
  const b = new ChainBuilder(track);
  b.begin({ def: 'start', cell: { x: -6, z: -2 }, level: 11, rot: 0 })
    .add('slope_steep')
    .add('scurve_r')
    .add('slope')
    .add('tube_slope')
    .add('tube')
    .add('scurve_l')
    .add('slope')
    .add('tube_slope')
    .add('bigcurve_r')
    .add('slope')
    .add('scurve_r')
    .add('slope_steep')
    .add('end');
}

/**
 * Demo 5: the same drop down two branches, so you can watch which surface wins.
 * The splitter alternates, the merge brings both back together.
 *
 * Fast branch: an ice run into the spring jump. Ice only pays off when the marble
 * does not have to start rolling again, and a jump pad is exactly that.
 * Slow branch: two brake runs, whose ridges eat more than half the speed.
 *
 * Both branches drop 2 levels over 6 cells, so they arrive at the merge together.
 */
export function buildRaceDemo(track: Track): void {
  const b = new ChainBuilder(track);
  b.begin({ def: 'start', cell: { x: -8, z: 0 }, level: 9, rot: 0 })
    .add('slope')
    .add('gate_fast')
    .add('slope')
    .add('splitter', { exitPort: 1 })
    // Fast branch: ice (2 cells, -1 level) then the jump pad (4 cells, -1 level).
    .add('ice')
    .add('jump')
    .add('merge', { entryPort: 2 })
    .add('slope')
    .add('slope_steep')
    .add('end');
  // Slow branch: two brakes (4 cells, -2 levels) plus two straights to match the other
  // branch's 6 cells, landing on the merge's remaining entry.
  const splitter = track.pieces.find((p) => p.placed.def === 'splitter')!;
  b.from(splitter, 2).add('brake').add('brake').add('straight').add('straight');
}

/** Demo 6: the family variants that the other demos never show - a twin helix, the fast gate, the small wheel, a short lift. */
export function buildVariantDemo(track: Track): void {
  const b = new ChainBuilder(track);
  // Level 8 at the start: the lift adds 6, then the helix (-4), gate, slopes and the wheel (-4)
  // give it all back, so anything lower puts the wheel's shaft underground.
  b.begin({ def: 'start', cell: { x: -8, z: 0 }, level: 8, rot: 0 })
    .add('slope_steep')
    .add('lift6')
    .add('helix2')
    .add('gate_fast')
    .add('slope')
    .add('wheel_fast')
    .add('bigcurve_l')
    .add('slope')
    .add('curve_r')
    .add('slope')
    .add('end');
}

export interface DemoDef {
  /** Label in the toolbar's demo picker. */
  name: string;
  /** Tooltip: which pieces this one is here to show. */
  hint: string;
  build(track: Track): void;
}

/** Preset tracks, in picker order. `editor.loadDemo(n)` takes the 1-based index. */
export const DEMOS: DemoDef[] = [
  { name: '示例 1 · 基础', hint: '直道、斜道、大小弯、螺旋、漏斗', build: buildDemoTrack },
  { name: '示例 2 · 机关', hint: '电梯、木琴、跷跷板、闸门、分叉、漩涡', build: buildMechanismDemo },
  { name: '示例 3 · 跳台', hint: '三圈螺旋、弹簧跳台、水车、随机分叉', build: buildJumpDemo },
  { name: '示例 4 · 变道与管道', hint: 'S 弯、管道、管道斜坡', build: buildTubeDemo },
  { name: '示例 5 · 快慢对决', hint: '分叉 → 冰道+跳台 对 减速带 → 合流', build: buildRaceDemo },
  { name: '示例 6 · 规格巡礼', hint: '同族零件的其他规格：短电梯、双圈螺旋、快闸门、小水车', build: buildVariantDemo },
];
