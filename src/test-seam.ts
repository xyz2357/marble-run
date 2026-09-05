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
    spawnAtStart: () => game.spawnAtStart().map((m) => m.id),
    finished: () => [...game.finished],
    pieces: () => game.track.toJSON(),
    ports: () =>
      game.track.allPorts().map(({ inst, port }) => ({
        piece: inst.placed.def,
        x: port.pos.x,
        y: port.pos.y,
        z: port.pos.z,
        dx: port.dir.x,
        dz: port.dir.z,
        kind: port.kind,
      })),
    loadTrack: (data: unknown) => {
      game.clearMarbles();
      game.finished.length = 0;
      game.track.load(data as never);
      game.frameTrack();
    },
    frameTrack: () => game.frameTrack(),
    lookAt: (x: number, y: number, z: number, dist: number) => {
      game.controls.target.set(x, y, z);
      game.camera.position.set(x + dist * 0.7, y + dist * 0.6, z + dist);
      game.controls.update();
    },
    setDebug: (on: boolean) => game.setDebug(on),
    ready: true,
  };
  (window as unknown as { __TEST__: typeof seam }).__TEST__ = seam;
}
