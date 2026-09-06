import { PIECE_KEYS, type Editor } from '../editor/editor';
import type { Game } from '../game/game';
import { paletteDefs, PIECES, sameFamily, variantsOf } from '../pieces/registry';
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
        <button data-action="demo">示例 1</button>
        <button data-action="demo2" title="机关演示：电梯、木琴、跷跷板、闸门、分叉、漩涡">示例 2</button>
        <button data-action="demo3" title="三圈螺旋、弹簧跳台、水车、随机分叉">示例 3</button>
        <button data-action="clear" class="danger">清空</button>
      </div>
      <div class="group">
        <button data-action="download">导出</button>
        <button data-action="import">导入</button>
        <input id="import-file" type="file" accept="application/json,.json" hidden />
      </div>
    </div>
    <div id="variants" hidden><span class="name"></span><span class="buttons"></span></div>
    <div id="palette"></div>
    <div id="picked-panel" hidden>
      <button data-picked="rotate" title="R">旋转</button>
      <button data-picked="variant" title="V">规格</button>
      <button data-picked="up" class="free-only" title="E">升</button>
      <button data-picked="down" class="free-only" title="Q">降</button>
      <button data-picked="delete" class="danger" title="Delete">删除</button>
      <button data-picked="close" title="Esc / 点空白处">✕</button>
    </div>
  `;

  const palette = root.querySelector<HTMLDivElement>('#palette')!;
  const thumbs = renderThumbnails(paletteDefs(), 72);
  paletteDefs().forEach((def, i) => {
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
    btn.addEventListener('click', () => editor.select(sameFamily(editor.selectedDef, def) ? null : def.id));
    palette.appendChild(btn);
  });

  // Variant bar: the members of the picked / selected piece's family (helix turns, lift height...).
  const variantBar = root.querySelector<HTMLDivElement>('#variants')!;
  const variantName = variantBar.querySelector<HTMLSpanElement>('.name')!;
  const variantButtons = variantBar.querySelector<HTMLSpanElement>('.buttons')!;
  let variantKey = '';
  const refreshVariants = (): void => {
    const ctx = editor.mode === 'edit' ? editor.variantContext : null;
    const vs = ctx ? variantsOf(ctx) : [];
    variantBar.hidden = vs.length < 2;
    if (vs.length < 2) {
      variantKey = '';
      return;
    }
    const key = vs.map((d) => d.id).join(',');
    if (key !== variantKey) {
      variantKey = key;
      variantName.textContent = `${ctx!.name.replace(/[ x×↑].*$/, '')} 规格`;
      variantButtons.innerHTML = '';
      for (const d of vs) {
        const b = document.createElement('button');
        b.dataset.variant = d.id;
        b.textContent = d.family!.label;
        b.title = `${d.name}（V 循环切换）`;
        b.addEventListener('click', () => editor.setVariant(d.id));
        variantButtons.appendChild(b);
      }
    }
    variantButtons.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('active', b.dataset.variant === ctx!.id));
  };

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
          if (game.track.pieces.length === 0 || confirm('用示例轨道替换当前轨道？（可撤销）')) editor.loadDemo(1);
          break;
        case 'demo2':
          if (game.track.pieces.length === 0 || confirm('用示例轨道替换当前轨道？（可撤销）')) editor.loadDemo(2);
          break;
        case 'demo3':
          if (game.track.pieces.length === 0 || confirm('用示例轨道替换当前轨道？（可撤销）')) editor.loadDemo(3);
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
        case 'variant':
          editor.cycleVariant();
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
        case 'close':
          editor.pick(null);
          break;
      }
    });
  });

  // Classic web annoyances: buttons must not keep keyboard focus (Space/Enter would re-trigger them),
  // and the browser context menu must not pop up over the game's panels.
  root.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('button')) e.preventDefault();
  });
  document.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
  });

  const playBar = createPlayBar(editor, game, root);

  const refresh = (): void => {
    playBar.refresh();
    root.querySelectorAll<HTMLButtonElement>('.piece').forEach((b) => {
      b.classList.toggle('active', sameFamily(editor.selectedDef, PIECES.get(b.dataset.id ?? '')));
    });
    refreshVariants();
    root.querySelector<HTMLButtonElement>('[data-picked="variant"]')!.hidden = !editor.picked || variantsOf(editor.picked.def).length < 2;
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
