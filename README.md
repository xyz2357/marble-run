# Marble Run 弹珠轨道

浏览器里玩的 3D 弹珠轨道拼装游戏。Three.js 渲染，Rapier3D（WASM）物理，Vite + TypeScript，Playwright 做回归测试和截图。

分阶段计划与进度见 [PLAN.md](PLAN.md)。

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Playwright 回归测试（自动起 dev server），截图在 test-results/
npm run typecheck
```

页面操作：空格 放弹珠，R 清空，D 物理线框，P 暂停，鼠标拖动旋转视角。

## 目录

```
src/
  main.ts          入口
  physics/world.ts Rapier 封装：固定步长 1/120 s、网格同步、调试线框
  geometry/        中心线 + U 形截面扫描出轨道网格（渲染与碰撞体共用）
  pieces/          零件定义：types（格子/接口/放置）、basic、helix、funnel、registry
  game/            track（放置、接口吸附、接龙）、marble、demo、game 主循环
  test-seam.ts     window.__TEST__，供 Playwright 驱动
tests/             Playwright 用例
levels/            示例存档 JSON
```

## 零件（20 种）

基础：起点、直道、斜道、陡坡、左/右小弯、左/右大弯、螺旋 x1/x2、漏斗、终点。
机关：漩涡碗（5x5）、分叉器（交替翻板）、合流、跷跷板、电梯 ↑6 / ↑10、定时闸门、木琴道。
"示例 2" 是一条把机关串起来的演示轨道。

## 弹珠形状

试玩工具条可选圆球 / 鸡蛋。鸡蛋是车削几何 + 凸包碰撞体，皮肤来自 `public/textures/egg.webp`（用户提供的鸡蛋照片），
由 `tools/make_egg_skin.py` 投影烘焙成 `public/textures/egg-skin.png`（正面贴照片，其余用蛋壳色填充）。换照片后重新跑脚本即可。

## 核心约定

- 水平格子 1 m，竖直层高 0.5 m；零件用 (格子 x, 层 level, 格子 z, 旋转 0–3) 放置。
- 每个零件声明进/出接口（位置 + 朝向），两个接口位置重合、方向相反即为接上。
- 零件几何必须是外向绕线的索引网格：同一份网格既渲染也作 Rapier trimesh 碰撞体（开了 FIX_INTERNAL_EDGES，对朝向敏感）。
- 同一块碰撞体里不能有叠放的甲板（重叠三角形的边界会产生幽灵碰撞）：分叉/合流用一个沿 X 变化的截面一次扫出。
- 轨道截面是半径 0.45 的圆弧槽 + 两侧护栏；平台类零件（电梯出口）用截面渐变从平底过渡到圆弧槽。
- 运动学机关（闸门、电梯门）在弹珠压在上面时不能升起；弹珠刚体永不休眠。
- 弹珠半径 0.15 m，开 CCD。
