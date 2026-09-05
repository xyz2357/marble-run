import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from './game/game';
import { installTestSeam } from './test-seam';

async function boot(): Promise<void> {
  await RAPIER.init();
  const container = document.getElementById('app');
  if (!container) throw new Error('#app not found');
  const game = new Game(container);
  installTestSeam(game);
  game.start();
}

boot().catch((err) => {
  console.error(err);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `启动失败: ${err}`;
});
