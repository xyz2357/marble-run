import RAPIER from '@dimforge/rapier3d-compat';
import { Editor } from './editor/editor';
import { Game } from './game/game';
import { installTestSeam } from './test-seam';
import { createPanel } from './ui/panel';
import { xylophoneHooks } from './pieces/xylophone';

async function boot(): Promise<void> {
  await RAPIER.init();
  const container = document.getElementById('app');
  if (!container) throw new Error('#app not found');
  const game = new Game(container);
  xylophoneHooks.play = (freq) => game.audio.note(freq);
  const editor = new Editor(game);
  createPanel(editor, game);

  if (!editor.loadAutosave()) editor.loadDemo();
  game.frameTrack();
  editor.setMode('edit');

  installTestSeam(game, editor);
  game.start();
  document.getElementById('boot')?.remove();
}

boot().catch((err) => {
  console.error(err);
  const splash = document.getElementById('boot');
  if (splash) {
    splash.classList.add('failed');
    splash.querySelector('p')!.textContent = '启动失败';
    splash.querySelector('small')!.textContent = String(err);
  }
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `启动失败: ${err}`;
});
