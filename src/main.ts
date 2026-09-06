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
}

boot().catch((err) => {
  console.error(err);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `启动失败: ${err}`;
});
