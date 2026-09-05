import type { Editor } from '../editor/editor';
import type { Game } from '../game/game';
import { listPieces } from '../pieces/registry';
import { renderThumbnails } from './thumbs';

/** Builds the HTML overlay: top toolbar + left piece palette, wired to the editor. */
export function createPanel(editor: Editor, game: Game): void {
  const root = document.getElementById('ui');
  if (!root) throw new Error('#ui not found');

  root.innerHTML = `
    <div id="toolbar">
      <div class="group">
        <button data-action="mode-edit" class="mode">编辑</button>
        <button data-action="mode-play" class="mode">试玩</button>
      </div>
      <div class="group">
        <button data-action="undo" title="Ctrl+Z">撤销</button>
        <button data-action="redo" title="Ctrl+Y">重做</button>
      </div>
      <div class="group">
        <button data-action="level-down" title="Q">层 −</button>
        <span id="level-label" class="label"></span>
        <button data-action="level-up" title="E">层 +</button>
      </div>
      <div class="group">
        <button data-action="frame">看全图</button>
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
  `;

  const palette = root.querySelector<HTMLDivElement>('#palette')!;
  const thumbs = renderThumbnails(listPieces(), 72);
  for (const def of listPieces()) {
    const btn = document.createElement('button');
    btn.className = 'piece';
    btn.dataset.id = def.id;
    btn.title = def.name;
    const thumb = thumbs.get(def.id);
    if (thumb) btn.appendChild(thumb);
    const label = document.createElement('span');
    label.textContent = def.name;
    btn.appendChild(label);
    btn.addEventListener('click', () => editor.select(editor.selectedDef?.id === def.id ? null : def.id));
    palette.appendChild(btn);
  }

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

  const refresh = (): void => {
    root.querySelectorAll<HTMLButtonElement>('.piece').forEach((b) => {
      b.classList.toggle('active', b.dataset.id === editor.selectedDef?.id);
    });
    root.querySelector('[data-action="mode-edit"]')!.classList.toggle('active', editor.mode === 'edit');
    root.querySelector('[data-action="mode-play"]')!.classList.toggle('active', editor.mode === 'play');
    (root.querySelector('[data-action="undo"]') as HTMLButtonElement).disabled = !editor.canUndo;
    (root.querySelector('[data-action="redo"]') as HTMLButtonElement).disabled = !editor.canRedo;
    root.querySelector('#level-label')!.textContent = `${editor.level}`;
    palette.classList.toggle('disabled', editor.mode !== 'edit');
  };
  editor.onChange = refresh;
  refresh();
}
