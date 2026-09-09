import { PIECE_KEYS, type Editor } from '../editor/editor';
import type { Game } from '../game/game';
import { DEMOS } from '../game/demo';
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
      <div class="group phone-more" id="toolmode-group">
        <button data-action="tool-chain" title="新零件接在橙色接口上">接龙</button>
        <button data-action="tool-free" title="鼠标指哪放哪，靠近接口时吸附">自由</button>
      </div>
      <div class="group">
        <button data-action="undo" title="Ctrl+Z">撤销</button>
        <button data-action="redo" title="Ctrl+Y">重做</button>
        <button data-action="frame" title="F">看全图</button>
      </div>
      <div class="group" id="level-group">
        <button data-action="level-down" title="Q / Shift+滚轮">层 −</button>
        <span id="level-label" class="label"></span>
        <button data-action="level-up" title="E / Shift+滚轮">层 +</button>
      </div>
      <div class="group phone-more">
        <button data-action="view-iso" title="等轴视角">等轴</button>
        <button data-action="view-top" title="俯视">俯视</button>
        <button data-action="view-side" title="侧视">侧视</button>
      </div>
      <div class="group phone-more">
        <select id="demo-select" title="载入一条预置示例轨道">
          <option value="" selected>示例…</option>
          ${DEMOS.map((d, i) => `<option value="${i + 1}" title="${d.hint}">${d.name}</option>`).join('')}
        </select>
        <button data-action="clear" class="danger">清空</button>
      </div>
      <div class="group phone-more">
        <button data-action="download">导出</button>
        <button data-action="import">导入</button>
        <input id="import-file" type="file" accept="application/json,.json" hidden />
        <button data-action="help" title="快捷键和玩法说明（? 或 H）">?</button>
      </div>
      <div class="group" id="more-group">
        <button data-action="more" title="更多">⋯</button>
      </div>
    </div>
    <div id="help" hidden>
      <h3>怎么玩<button data-action="help-close" title="Esc">✕</button></h3>
      <div class="cols">
        <section>
          <h4>两种搭建方式</h4>
          <dl>
            <dt>接龙</dt><dd>新零件自动接到橙色接口上，最省事</dd>
            <dt>自由</dt><dd>鼠标指哪放哪，靠近接口时会吸附</dd>
          </dl>
          <h4>编辑</h4>
          <dl>
            <dt><kbd>1</kbd>–<kbd>9</kbd></dt><dd>选零件（零件栏左上角的数字）</dd>
            <dt><kbd>Enter</kbd></dt><dd>放下当前零件</dd>
            <dt><kbd>R</kbd></dt><dd>换接法 / 旋转选中的零件</dd>
            <dt><kbd>V</kbd></dt><dd>换规格：电梯高度、螺旋圈数、闸门快慢、电梯玻璃或实心</dd>
            <dt><kbd>Q</kbd> <kbd>E</kbd></dt><dd>升降一层（选中零件时移动它）</dd>
            <dt><kbd>Backspace</kbd></dt><dd>撤掉刚放的一块</dd>
            <dt><kbd>Delete</kbd></dt><dd>删除选中的零件</dd>
            <dt><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd></dt><dd>撤销 / 重做</dd>
            <dt><kbd>Esc</kbd></dt><dd>取消选择</dd>
          </dl>
        </section>
        <section>
          <h4>视角</h4>
          <dl>
            <dt>拖动 / 滚轮</dt><dd>旋转 / 缩放</dd>
            <dt><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dt><dd>平移</dd>
            <dt><kbd>F</kbd></dt><dd>看全图</dd>
          </dl>
          <h4>试玩<span class="tag">Tab 切换</span></h4>
          <dl>
            <dt><kbd>Space</kbd></dt><dd>放 1 颗</dd>
            <dt><kbd>B</kbd></dt><dd>放 8 颗</dd>
            <dt><kbd>N</kbd></dt><dd>连发</dd>
            <dt><kbd>R</kbd></dt><dd>重置</dd>
            <dt><kbd>T</kbd></dt><dd>慢动作</dd>
            <dt><kbd>C</kbd></dt><dd>相机跟随领先的弹珠</dd>
            <dt><kbd>P</kbd></dt><dd>暂停</dd>
            <dt><kbd>M</kbd></dt><dd>静音</dd>
          </dl>
          <h4>弹珠</h4>
          <p>底部下拉可换：玻璃珠是标准，钢珠更沉更快，橡胶珠抓地、落地会弹，发光珠会亮，还有鸡蛋。</p>
        </section>
      </div>
    </div>
    <div id="variants" hidden><span class="name"></span><span class="buttons"></span></div>
    <div id="palette"></div>
    <button id="palette-toggle" data-action="palette-toggle">零件 ▲</button>
    <div id="picked-panel" hidden>
      <button data-picked="rotate" title="R">旋转</button>
      <button data-picked="variant" title="V">规格</button>
      <button data-picked="up" class="free-only" title="E">升</button>
      <button data-picked="down" class="free-only" title="Q">降</button>
      <button data-picked="delete" class="danger" title="Delete">删除</button>
      <button data-picked="close" title="Esc / 点空白处">✕</button>
    </div>
  `;

  const toolbar = root.querySelector<HTMLDivElement>('#toolbar')!;
  const hudEl = document.getElementById('hud');
  // The toolbar wraps to two rows on a phone and grows again when "..." is open, and the HUD's
  // own height changes with its message, so anything stacked under them has to follow. CSS gets
  // the measurements as variables rather than a guessed constant.
  // On :root, not on #ui - the HUD is a sibling of #ui, so a variable set there never reaches it.
  // --playbar-h is how much room the bottom bar wants, an 8px gap included - it goes to two rows
  // on a phone, and it is display:none in edit mode, which the observer reports as height 0. So
  // "0px when the bar is down" falls out of it, and anything sitting above it can just add.
  const publishSizes = (): void => {
    const css = document.documentElement.style;
    css.setProperty('--toolbar-h', `${Math.round(toolbar.getBoundingClientRect().height)}px`);
    if (hudEl) css.setProperty('--hud-h', `${Math.round(hudEl.getBoundingClientRect().height)}px`);
    const bar = document.getElementById('playbar');
    const barH = bar ? Math.round(bar.getBoundingClientRect().height) : 0;
    css.setProperty('--playbar-h', `${barH ? barH + 8 : 0}px`);
  };
  const stack = new ResizeObserver(publishSizes);
  stack.observe(toolbar);
  if (hudEl) stack.observe(hudEl);

  const palette = root.querySelector<HTMLDivElement>('#palette')!;
  const paletteToggle = root.querySelector<HTMLButtonElement>('#palette-toggle')!;
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
      variantName.textContent = `${ctx!.name.replace(/[ x×].*$/, '')} 规格`;
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

  const help = root.querySelector<HTMLDivElement>('#help')!;
  const toggleHelp = (on = help.hidden) => {
    help.hidden = !on;
  };
  // ? and H open it; Esc closes. The editor ignores keys typed into inputs, and so does this.
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.key === '?' || e.key.toLowerCase() === 'h') toggleHelp();
    else if (e.key === 'Escape' && !help.hidden) toggleHelp(false);
  });

  // Demo picker: loading resets the select so picking the same demo twice works.
  const demoSelect = root.querySelector<HTMLSelectElement>('#demo-select')!;
  demoSelect.addEventListener('change', () => {
    const which = Number(demoSelect.value);
    demoSelect.value = '';
    if (!which) return;
    if (game.track.pieces.length === 0 || confirm('用示例轨道替换当前轨道？（可撤销）')) editor.loadDemo(which);
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
        case 'more':
          root.querySelector('#toolbar')!.classList.toggle('expanded');
          break;
        case 'palette-toggle': {
          const open = palette.classList.toggle('open');
          btn.textContent = open ? '零件 ▼' : '零件 ▲';
          break;
        }
        case 'help':
          toggleHelp();
          break;
        case 'help-close':
          toggleHelp(false);
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
  const playBarEl = root.querySelector<HTMLDivElement>('#playbar');
  if (playBarEl) stack.observe(playBarEl);

  // A bar that scrolls sideways is indistinguishable from one that fits, and the scrollbar is
  // hidden on a phone. Record which end still has content behind it so CSS can fade that edge.
  const markScroll = (el: HTMLElement): void => {
    const update = (): void => {
      const max = el.scrollWidth - el.clientWidth;
      const state = max <= 1 ? 'none' : el.scrollLeft <= 1 ? 'start' : el.scrollLeft >= max - 1 ? 'end' : 'mid';
      // Only when it changes: writing the attribute is itself a mutation this observer sees.
      if (el.dataset.scroll !== state) el.dataset.scroll = state;
    };
    el.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(el);
    new MutationObserver(update).observe(el, { childList: true, subtree: true });
    update();
  };
  markScroll(variantBar);

  const refresh = (): void => {
    playBar.refresh();
    // Straight away, not on the observer's next tick: the play bar appears and disappears with
    // the mode, and the race panel and the HUD are positioned off its height. Waiting a frame
    // for the ResizeObserver put them on top of it for that frame.
    publishSizes();
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
    paletteToggle.hidden = palette.hidden;
    root.querySelector('#toolmode-group')!.classList.toggle('disabled', editor.mode !== 'edit');
  };
  editor.onChange = refresh;
  refresh();
}
