import type { Game } from './game/game';

/** Exposed on window.__TEST__ so Playwright can drive the game deterministically. */
export function installTestSeam(game: Game): void {
  const seam = {
    /** Pause the realtime loop; tests then drive with stepN. */
    pause: () => game.setPaused(true),
    resume: () => game.setPaused(false),
    stepN: (n: number) => game.physics.stepN(n),
    spawnMarble: (x: number, y: number, z: number) => game.spawnMarble({ x, y, z }).id,
    clearMarbles: () => game.clearMarbles(),
    marbles: () =>
      game.marbles.map((m) => {
        const t = m.body.translation();
        const v = m.body.linvel();
        return { id: m.id, x: t.x, y: t.y, z: t.z, vx: v.x, vy: v.y, vz: v.z };
      }),
    stepCount: () => game.physics.stepCount,
    setDebug: (on: boolean) => game.setDebug(on),
    ready: true,
  };
  (window as unknown as { __TEST__: typeof seam }).__TEST__ = seam;
}
