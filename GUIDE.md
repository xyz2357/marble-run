# GUIDE — 接手这个项目的操作手册

给下一个接手的 AI 模型。这份文档假设你没有之前的对话记忆，只有这个仓库。**按顺序读：本文 → HANDOFF.md（架构、已知坑、待办）→ README.md → PLAN.md。** 遇到不确定的事，先看代码里的注释，再问用户。

- 线上地址：https://xyz2357.github.io/marble-run/ （push 到 master 后 GitHub Actions 自动构建发布）
- 仓库：https://github.com/xyz2357/marble-run
- 本地目录：`C:\vibe-coding\marble`，Windows 11，Node 24，Python 3

## 0. 和用户合作的规则（最重要）

1. **用中文交流。** 每做完一个里程碑就汇报：做了什么、怎么验证的（测试结果 + 截图）、还有什么没做。
2. **push 到 GitHub 前、部署前必须问用户**，每次都问，一次"可以"不代表以后都可以。push 就等于发布到线上。自动模式的权限系统可能会拦住 `gh` / `git push`，那就把命令原样给用户，请用户在会话里用 `! <命令>` 自己执行。
3. **不要猜物理问题的原因。** 弹珠卡住/飞出/穿模，一律先写探针测试打印逐帧位置、速度、接触点（见第 4 节），找到根因再改。之前每一次"猜着改"都改错了。
4. 每个里程碑：`npm test` 全过 → `git commit` → 打 tag（`stage-5a` 这样）→ 截图 → 汇报。本地 commit 不用问，push 要问。
5. 用户会亲自试玩并给手感反馈，优先解决用户提出的问题，而不是自己想做的功能。
6. 用户说过"根据你的节奏来，一次可以多做一点"——一轮可以做几项，但每一项都要有测试。不确定的设计问题（比如公开还是私有、要不要删某个功能）先问。

## 1. 开工检查清单

```bash
cd /c/vibe-coding/marble
git status            # 应该干净；不干净先弄清楚是什么
npm install           # 第一次
npm run typecheck     # 应该没有输出
npm test              # 35 条 Playwright 全过，约 2 分钟（会自动起 dev server）
npm run dev           # http://localhost:5173，用户试玩用
```

`npm test` 全过后再开始改代码。测试跑的时候**不要改 `src/` 或 `index.html`**：Vite 热重载会刷新测试页面，测试会报 `Execution context was destroyed`（这不是代码 bug，重跑就好）。

## 2. 代码地图（细节看 HANDOFF.md）

| 位置 | 内容 |
|---|---|
| `src/geometry/sweep.ts` | 截面沿路径扫描出网格（渲染和碰撞体共用）。`TRACK_PROFILE` 是标准轨道截面（圆弧槽 + 护栏）。`sweep`、`sweepStations`、`ringShell`、`slopePath`、`arcPath`、`bezierPath`、`lerpProfile`、`boxGeo`、`mergeGeometries`。 |
| `src/pieces/*.ts` | 每种零件一个文件；`registry.ts` 是注册表（顺序 = 零件栏顺序；`family` 同族折叠）。 |
| `src/pieces/types.ts` | `PieceDef`、`PlacedPiece`、`BuiltPiece`、`Mechanism`、坐标工具。 |
| `src/game/track.ts` | 放置/删除零件、接口配对、`canPlace`、`ChainBuilder`（代码接龙）。 |
| `src/game/game.ts` | 主循环：固定步长 1/120 s，`step(n)`；弹珠生成、比赛计时、跟随相机、慢动作。 |
| `src/game/marble.ts` | 弹珠（圆球 / 鸡蛋）。 |
| `src/game/audio.ts` | Web Audio 合成音效。 |
| `src/game/demo.ts` | 示例 1/2/3（代码接龙生成）。 |
| `src/editor/editor.ts` | 编辑器：接龙模式、自由模式、选中编辑、撤销、自动存档、相机、快捷键、规格切换。 |
| `src/ui/panel.ts`、`playbar.ts`、`thumbs.ts` | HTML 叠层 UI；样式全在 `index.html` 的 `<style>` 里。 |
| `src/test-seam.ts` | `window.__TEST__`，Playwright 用它驱动一切。加新功能时顺手加 seam。 |
| `tests/stage*.spec.ts` | 回归测试。截图输出到 `test-results/`（每次运行会清空）。 |
| `tools/make_egg_skin.py` | 鸡蛋贴图烘焙脚本。 |
| `scratch/` | 已 gitignore，放临时脚本和探针。 |

坐标约定：水平格子 1 m（`CELL`），层高 0.5 m（`H`）。零件本地坐标：锚点格子中心是原点，`+X` 是"向前"，接口在格子边中点。`rot` 是绕 +Y 的 90° 倍数。

## 3. 怎么加一个新零件

照抄一个最像的现有零件：静态零件看 `basic.ts`（直道/斜道/弯道）、`funnel.ts`；带机关的看 `gate.ts`（最短，运动学刚体 + 每步 update）、`seesaw.ts`（动态刚体 + 铰链）、`jump.ts`（击发 + 计量闸门）、`wheel.ts`（旋转 + 圆弧外壳）。

最小模板：

```ts
import { slopePath, sweep } from '../geometry/sweep';
import { H, v3, type PieceDef } from './types';

export const myPieceDef: PieceDef = {
  id: 'my_piece',            // 存档里用这个 id，定了就别改
  name: '我的零件',
  footprint: [{ x: 0, z: 0 }, { x: 1, z: 0 }],   // 占哪些格子（本地坐标）
  heightUnits: 2,            // 占几层（用于重叠检测）
  ports: [
    { pos: v3(-0.5, H, 0), dir: v3(-1, 0, 0), kind: 'in' },   // 入口：高一层
    { pos: v3(1.5, 0, 0), dir: v3(1, 0, 0), kind: 'out' },    // 出口：低一层
  ],
  build() {
    return { parts: [{ geometry: sweep(slopePath(v3(-0.5, H, 0), v3(1.5, 0, 0)), 24), material: 'wood' }] };
  },
};
```

检查清单：

- [ ] 接口位置必须在格子边中点，高度是 `H` 的整数倍；方向是轴向单位向量，指向零件外面。
- [ ] 能做成下坡的都做成下坡（平直段会让慢球和鸡蛋停住）。
- [ ] 几何是**外向绕线**的索引网格。自己拼三角形时算一下有向体积应为正（`scratch/check_ring.ts` 有例子，用 `npx esbuild xxx.ts --bundle --platform=node --outfile=xxx.cjs && node xxx.cjs` 跑）。车削（Lathe）轮廓方向反了弹珠会穿进实体。
- [ ] 同一碰撞体里不能叠两块甲板（边界边会产生幽灵碰撞）。
- [ ] 运动学部件：不能把球夹在自己和静止几何之间（会把球弹飞几米）；有球压着时不升起；等区域清空再动作。
- [ ] 在 `registry.ts` 的 `defs` 里注册。同族规格加 `family: { id, label }`，并排放一起，第一个是零件栏条目。
- [ ] `tests/stage4d.spec.ts` 里断言零件栏有 20 个条目：加了新零件栏条目要改这个数字。
- [ ] 写一条 Playwright 测试：起点 → 新零件 → 终点，弹珠必须到达；再用 `spawnBurst(3, 1.5)` 加上 `setMode('play')` 自带的那一颗做多球压力测试（两颗几乎重叠出发，最容易暴露夹球问题）。
- [ ] 放进某条示例轨道，或者新建示例，用 `ChainBuilder` 接龙（它会在接不上或重叠时抛异常，很好用）。
- [ ] 截图看一眼外观（`lookAt(x, y, z, dist)` 后 `page.screenshot`）。

## 4. 怎么调物理问题（探针模板）

在 `tests/` 下新建 `probe-xxx.spec.ts`（调完删掉，不要提交），核心就是逐帧打印：

```ts
import { test } from '@playwright/test';
test('probe', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__TEST__?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const t = (window as any).__TEST__;
    t.importJSON(JSON.stringify({ version: 1, pieces: [
      { def: 'start', cell: { x: 0, z: 0 }, level: 3, rot: 0 },
      { def: 'my_piece', cell: { x: 1, z: 0 }, level: 2, rot: 0 },
      { def: 'end', cell: { x: 3, z: 0 }, level: 2, rot: 0 },
    ]}));
    t.setMode('play'); t.pause();
  });
  for (let i = 0; i < 100; i++) {
    await page.evaluate(() => (window as any).__TEST__.stepN(12));   // 0.1 s
    const ms = await page.evaluate(() => (window as any).__TEST__.marbles());
    const c = await page.evaluate((id) => (window as any).__TEST__.contacts(id), ms[0]?.id);
    console.log((i / 10).toFixed(1), JSON.stringify(ms.map((m: any) => [+m.x.toFixed(2), +m.y.toFixed(2), +m.z.toFixed(2), +m.vx.toFixed(1), +m.vy.toFixed(1), +m.vz.toFixed(1)])), JSON.stringify(c));
  }
});
```

跑：`npx playwright test tests/probe-xxx.spec.ts --reporter=line 2>&1 | grep -v "^$"`。输出很长时重定向到 `scratch/out.txt` 再用 python 筛。

`contacts(id)` 返回弹珠的接触法线和接触点（世界坐标）：**先把世界坐标减去零件原点换算成零件本地坐标**，再对照零件代码里的常量，就能知道它压在什么东西上。

常见症状对照：

| 症状 | 通常原因 |
|---|---|
| 弹珠在某处停住，速度 0 | 平直段太长 / 上坡 / 卡在两个面之间（看 contacts 法线是不是夹角很小） |
| 弹珠贴着面滚但高度比预期低几厘米 | 网格朝向反了，球在实体外壳上滚 |
| 弹珠在中线上被莫名弹一下 | 幽灵边：同一碰撞体里叠了甲板，或坍缩三角形删掉后留下边界边 |
| 弹珠突然以 4–9 m/s 飞出 | 运动学部件把球夹住了（闸门升起压球、翻板翻进球、叶片顶球抵墙） |
| 弹珠跳过某个坑/挡板 | 来的速度太快，抛物线飞过去了；用贝塞尔曲线把轨道切线连续地弯下去 |
| 弹珠偶尔（不是每次）丢失 | 多球干扰；用 `spawnBurst(3, 1.5)` 连跑 6 轮找出丢球轨迹（见 HANDOFF 的夹球条目） |

`topView(x, y, z, height)` 和 `lookAt(x, y, z, dist)` 后截图，用 Read 工具看图也很有效。

## 5. 工具坑（Windows + 这个工具链）

- **Bash heredoc 写长文件会失败**（`unexpected EOF while looking for matching`）。写新文件、大段改动用 Write 工具；小改动用 python 脚本做字符串替换（先 Write 脚本到 `scratch/xxx.py` 再运行），替换前 `assert old in s` 防止静默失败。
- **仓库文件是 CRLF 换行。** python 写文件要用 `newline=''` 或把 `\n` 换回 `\r\n`，否则整个文件都算改动。提交前 `git diff --cached --stat` 看一眼行数是否合理。
- Git Bash 会把 `/marble-run/` 这样的参数转成 Windows 路径。设了 `BASE_PATH` 之类的路径变量时加 `MSYS_NO_PATHCONV=1`。
- Playwright 用 `workers: 2`，改成 4 会因为机器慢误报超时。单个文件：`npx playwright test tests/stage4d.spec.ts --reporter=line`；按名字：`-g "wheel"`。
- `setMode('play')` 会自动放一颗弹珠，再 `spawnBurst` 就会有两颗几乎重叠出发（第一颗排队号是 0 s）。写测试时要记得。
- `test-results/` 每次运行都被清空，截图要在同一次运行里看。
- 长时间命令用 `run_in_background`，不要 `sleep` 轮询。
- `npx tsc --noEmit -p .` 没输出就是通过；`npm run build` 里包含它。

## 6. Stage 5 任务拆解（按顺序做，每项都有验收标准）

### 5.1 预置关卡（先做这个，简单）

- 把三个示例改成"关卡列表"：`levels/*.json`（用编辑器"导出"生成，或用 `ChainBuilder` 在测试里生成后 `exportJSON()` 存下来），加 2 条新关卡凑够 5 条：一条纯基础零件的长赛道（适合 8 颗比赛），一条鸡蛋专用的全下坡赛道。
- UI：工具栏里"示例 1/2/3"换成一个下拉或菜单；`editor.loadDemo(n)` 改成 `loadLevel(id)`（保留旧 seam 名字或同步改 `tests/`）。
- 首次打开（无自动存档）时加载第一关。
- 验收：每条关卡 `openPortsScreen()` 为空（所有接口都接上）；放 3 颗球 60 s 内全部到达；Playwright 测试覆盖 5 条。

### 5.2 URL 分享

- 存档 JSON → `CompressionStream('deflate-raw')` 压缩 → base64url → 放到 `location.hash`（如 `#t=...`）。加载优先级：hash > localStorage 自动存档 > 第一关。
- 工具栏加"分享"按钮：写入 hash 并复制到剪贴板（`navigator.clipboard.writeText`，失败就弹出文本让用户自己复制）。
- 注意：GitHub Pages 的地址带子路径，hash 不受影响。JSON 里只有 `def/cell/level/rot`，几十个零件压缩后几百字节。
- 验收：测试里导出 → 读 hash → 新开页面带 hash → `pieces()` 一致。

### 5.3 手机触控

- 现状：鼠标事件已用 pointer 事件写，OrbitControls 自带双指缩放/旋转；但按钮小、快捷键提示无意义、`hover` 逻辑对触摸不成立。
- 要做：`@media (pointer: coarse)` 放大按钮和零件栏；触摸时接龙模式"点一下 = 放置"、"点零件 = 选中"（现在就是这样，验证一下）；HUD 里的键盘提示在触摸设备上隐藏；`touch-action: none` 防止页面滚动；工具栏太宽时可横向滚动。
- 验收：Playwright 用 `devices['Pixel 7']` 跑一遍：能加载、能放零件、能放球到终点。

### 5.4 视觉打磨（用户提过的：漏斗像圆桌、电梯塔是黑柱子、水车落料井是黑箱子）

- 漏斗：外壁改成薄壁碗（车削一个有厚度的轮廓，而不是实心圆盘），底下加几根腿。
- 电梯：井壁改成镂空框架 + 半透明面板（`MeshStandardMaterial({ transparent: true, opacity: 0.35 })`），碰撞体不变。
- 水车落料井：同样做成框架 + 半透明。
- 木纹：给 `wood` 材质加程序化 `CanvasTexture` 木纹（条纹 + 噪声），用 `map` 而不是改几何。
- 只改 `material` / 视觉 `collide: false` 的部件，**不要动碰撞几何**，改完跑全套测试证明物理没变。
- 验收：截图前后对比给用户看。

### 5.5 性能 / 包体（可选）

- 打包 3.5 MB（gzip 1.3 MB），大头是 Rapier WASM 和 Three。可以把 Rapier 改成异步 `import()` 显示"加载中"，或让 Vite `manualChunks` 拆开。
- 弹珠多时（60 颗）FPS 会掉，`MAX_MARBLES` 在 `game.ts`。

### 5.6 部署

- 已完成：`.github/workflows/pages.yml`，push master 自动发布。**每次 push 前问用户。**
- 若工作流失败先 `gh run view <id> --log-failed`。

### 之后（用户没催，别抢着做）

- 多口零件自动铺路（用户明确说先不做）。
- 合流手感（有一次撞护栏，掉速 10–20%，可接受）。
- 鸡蛋在跳台、水车上没测过。
- 更多零件：计数分流、多米诺、环形 loop。

## 7. 绝对不要做的事

- 不问用户就 `git push`、部署、改 GitHub 仓库设置。
- 改现有零件的 `id`（会让用户存档失效）；改 `PlacedPiece` 存档格式而不做版本迁移。
- 改碰撞体相关的常量（半径、密度、摩擦、`FIX_INTERNAL_EDGES`、固定步长）来"修"某一个零件的问题——这会影响所有零件。
- 删掉或跳过失败的测试来让测试变绿。
- 测试跑的时候改 `src/`。
- 用 `git push --force`、`git reset --hard`、`rm -rf` 这类命令，除非用户明确要求。
- 在一个回合里改十几个文件却不跑测试。

## 8. 汇报模板

```
做了：xxx（commit abc1234，tag stage-5a）
验证：npm test 36/36 通过；截图 test-results/xxx.png（描述看到了什么）
发现/修掉的坑：……
没做 / 需要你决定：……
下一步打算：……
```
