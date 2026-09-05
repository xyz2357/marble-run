import { PIECE_KEYS, type Editor } from '../editor/editor';
import type { Game } from '../game/game';
import { listPieces } from '../pieces/registry';
import { createPlayBar } from './playbar';
import { renderThumbnails } from './thumbs';

/** Builds the HTML overlay: top toolbar, left piece palette, floating panel for the picked piece. */
export function createPanel(editor: Editor, game: Game): void {
  const root = document.getElementById('ui');
  if (!root) throw new Error('#ui not found');

  root.innerHTML = `
    <div id="toolbar">
      <div class="group">
        <button data-action="mode-edit" class="mode">编辑</button>
        <button data-action="mode-play" class="mode">试玩</button>
      </div>
      <div class="group" id="toolmode-group">
        <button data-action="tool-chain" title="新零件接在橙色接口上">接龙</button>
        <button data-action="tool-free" title="鼠标指哪放哪，靠近接口时吸附">自由</button>
      </div>
      <div class="group">
        <button data-action="undo" title="Ctrl+Z">撤销</button>
        <button data-action="redo" title="Ctrl+Y">重做</button>
      </div>
      <div class="group" id="level-group">
        <button data-action="level-down" title="Q / Shift+滚轮">层 −</button>
        <span id="level-label" class="label"></span>
        <button data-action="level-up" title="E / Shift+滚轮">层 +</button>
      </div>
      <div class="group">
        <button data-action="view-iso" title="等轴视角">等轴</button>
        <button data-action="view-top" title="俯视">俯视</button>
        <button data-action="view-side" title="侧视">侧视</button>
        <button data-action="frame" title="F">看全图</button>
      </div>
      <div class="group">
        <button data-action="demo">示例轨道</button>
        <button data-action="clear" class="danger">清空</button>
      </div>
      <div class="group">
        <button data-action="download">导出</button>
        <button data-action="import">导入</button>
        <input id="import-file" type="file" accept="application/json,.json" hidden />
      </div>
    </div>
    <div id="palette"></div>
    <div id="picked-panel" hidden>
      <button data-picked="rotate" title="R">旋转</button>
      <button data-picked="up" class="free-only" title="E">升</button>
      <button data-picked="down" class="free-only" title="Q">降</button>
      <button data-picked="delete" class="danger" title="Delete">删除</button>
    </div>
  `;

  const palette = root.querySelector<HTMLDivElement>('#palette')!;
  const thumbs = renderThumbnails(listPieces(), 72);
  listPieces().forEach((def, i) => {
    const btn = document.createElement('button');
    btn.className = 'piece';
    btn.dataset.id = def.id;
    btn.title = `${def.name}${PIECE_KEYS[i] ? `（快捷键 ${PIECE_KEYS[i]}）` : ''}`;
    const thumb = thumbs.get(def.id);
    if (thumb) btn.appendChild(thumb);
    if (PIECE_KEYS[i]) {
      const key = document.createElement('kbd');
      key.textContent = PIECE_KEYS[i];
      btn.appendChild(key);
    }
    const label = document.createElement('span');
    label.textContent = def.name;
    btn.appendChild(label);
    btn.addEventListener('click', () => editor.select(editor.selectedDef?.id === def.id ? null : def.id));
    palette.appendChild(btn);
  });

  const fileInput = root.querySelector<HTMLInputElement>('#import-file')!;
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    try {
      editor.importJSON(await f.text());
    } catch (err) {
      alert(`导入失败：${(err as Error).message}`);
    }
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switch (btn.dataset.action) {
        case 'mode-edit':
          editor.setMode('edit');
          break;
        case 'mode-play':
          editor.setMode('play');
          break;
        case 'tool-chain':
          editor.setToolMode('chain');
          break;
        case 'tool-free':
          editor.setToolMode('free');
          break;
        case 'undo':
          editor.undo();
          break;
        case 'redo':
          editor.redo();
          break;
        case 'level-down':
          editor.setLevel(editor.level - 1);
          break;
        case 'level-up':
          editor.setLevel(editor.level + 1);
          break;
        case 'view-iso':
          editor.setView('iso');
          break;
        case 'view-top':
          editor.setView('top');
          break;
        case 'view-side':
          editor.setView('side');
          break;
        case 'frame':
          game.frameTrack();
          break;
        case 'demo':
          if (game.track.pieces.length === 0 || confirm('用示例轨道替换当前轨道？（可撤销）')) editor.loadDemo();
          break;
        case 'clear':
          if (game.track.pieces.length === 0 || confirm('清空整条轨道？（可撤销）')) editor.clear();
          break;
        case 'download':
          editor.download();
          break;
        case 'import':
          fileInput.click();
          break;
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-picked]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switch (btn.dataset.picked) {
        case 'rotate':
          editor.rotatePicked();
          break;
        case 'up':
          editor.movePicked(0, 1, 0);
          break;
        case 'down':
          editor.movePicked(0, -1, 0);
          break;
        case 'delete':
          editor.deletePicked();
          break;
      }
    });
  });

  const playBar = createPlayBar(editor, game, root);

  const refresh = (): void => {
    playBar.refresh();
    root.querySelectorAll<HTMLButtonElement>('.piece').forEach((b) => {
      b.classList.toggle('active', b.dataset.id === editor.selectedDef?.id);
    });
    const setActive = (action: string, on: boolean) => root.querySelector(`[data-action="${action}"]`)!.classList.toggle('active', on);
    setActive('mode-edit', editor.mode === 'edit');
    setActive('mode-play', editor.mode === 'play');
    setActive('tool-chain', editor.toolMode === 'chain');
    setActive('tool-free', editor.toolMode === 'free');
    (root.querySelector('[data-action="undo"]') as HTMLButtonElement).disabled = !editor.canUndo;
    (root.querySelector('[data-action="redo"]') as HTMLButtonElement).disabled = !editor.canRedo;
    root.querySelector('#level-label')!.textContent = `${editor.level}`;
    root.querySelector('#level-group')!.classList.toggle('dim', editor.toolMode === 'chain');
    palette.hidden = editor.mode !== 'edit';
    root.querySelector('#toolmode-group')!.classList.toggle('disabled', editor.mode !== 'edit');
  };
  editor.onChange = refresh;
  refresh();
}
