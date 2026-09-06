import type { Editor } from '../editor/editor';
import type { Game } from '../game/game';
import { MARBLE_SHAPES, type MarbleShape } from '../game/marble';

/** Bottom bar with marble controls and the race panel, visible in play mode. */
export function createPlayBar(editor: Editor, game: Game, root: HTMLElement): { refresh: () => void } {
  const bar = document.createElement('div');
  bar.id = 'playbar';
  bar.hidden = true;
  bar.innerHTML = `
    <button data-play="one" class="primary">放 1 颗<kbd>Space</kbd></button>
    <button data-play="burst" class="primary">放 8 颗<kbd>B</kbd></button>
    <button data-play="auto">连发<kbd>N</kbd></button>
    <button data-play="reset">重置<kbd>R</kbd></button>
    <button data-play="slow">慢动作<kbd>T</kbd></button>
    <button data-play="follow">跟随<kbd>C</kbd></button>
    <button data-play="pause">暂停<kbd>P</kbd></button>
    <button data-play="mute">音效<kbd>M</kbd></button>
    <label class="shape">形状
      <select data-play="shape">${MARBLE_SHAPES.map((sh) => `<option value="${sh.id}">${sh.name}</option>`).join('')}</select>
    </label>
  `;
  root.appendChild(bar);

  const race = document.createElement('div');
  race.id = 'race';
  race.hidden = true;
  race.innerHTML = `<h3><span>比赛</span><span class="clock">0.00 s</span></h3><ol></ol><div class="empty">还没有弹珠到达终点</div>`;
  root.appendChild(race);
  const clock = race.querySelector<HTMLSpanElement>('.clock')!;
  const list = race.querySelector<HTMLOListElement>('ol')!;
  const empty = race.querySelector<HTMLDivElement>('.empty')!;

  const shapeSelect = bar.querySelector<HTMLSelectElement>('select[data-play="shape"]')!;
  shapeSelect.addEventListener('change', () => game.setMarbleShape(shapeSelect.value as MarbleShape));

  bar.querySelectorAll<HTMLButtonElement>('button[data-play]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switch (btn.dataset.play) {
        case 'one':
          game.spawnAtStart();
          break;
        case 'burst':
          game.spawnBurst(8);
          break;
        case 'auto':
          game.setAutoSpawn(!game.autoSpawn);
          break;
        case 'reset':
          game.clearMarbles();
          game.spawnAtStart();
          break;
        case 'slow':
          game.setTimeScale(game.timeScale === 1 ? 0.25 : 1);
          break;
        case 'follow':
          game.setFollow(!game.follow);
          break;
        case 'pause':
          game.setPaused(!game.isPaused);
          refresh();
          break;
        case 'mute':
          game.audio.setMuted(!game.audio.muted);
          refresh();
          break;
      }
    });
  });

  let lastResults = -1;
  const refresh = (): void => {
    const play = editor.mode === 'play';
    bar.hidden = !play;
    race.hidden = !play;
    if (!play) return;
    const setActive = (key: string, on: boolean) => bar.querySelector(`[data-play="${key}"]`)!.classList.toggle('active', on);
    setActive('auto', game.autoSpawn);
    setActive('slow', game.timeScale !== 1);
    setActive('follow', game.follow);
    setActive('pause', game.isPaused);
    setActive('mute', !game.audio.muted);
    shapeSelect.value = game.marbleShape;
    bar.querySelector('[data-play="mute"]')!.textContent = '';
    bar.querySelector('[data-play="mute"]')!.insertAdjacentHTML('beforeend', `${game.audio.muted ? '静音' : '音效'}<kbd>M</kbd>`);

    if (game.results.length !== lastResults) {
      lastResults = game.results.length;
      list.innerHTML = '';
      game.results.forEach((r, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="rank">${i + 1}</span><span class="dot" style="background:#${r.color.toString(16).padStart(6, '0')}"></span><span class="time">${r.time.toFixed(2)} s</span>`;
        list.appendChild(li);
      });
      empty.hidden = game.results.length > 0;
    }
  };

  // The clock ticks every frame; the rest refreshes on change.
  const tick = (): void => {
    if (editor.mode === 'play') clock.textContent = `${game.simTime.toFixed(2)} s`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  game.onRaceChange = refresh;
  return { refresh };
}
