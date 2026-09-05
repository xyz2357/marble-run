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

## 核心约定

- 水平格子 1 m，竖直层高 0.5 m；零件用 (格子 x, 层 level, 格子 z, 旋转 0–3) 放置。
- 每个零件声明进/出接口（位置 + 朝向），两个接口位置重合、方向相反即为接上。
- 零件几何必须是外向绕线的索引网格：同一份网格既渲染也作 Rapier trimesh 碰撞体（开了 FIX_INTERNAL_EDGES，对朝向敏感）。
- 弹珠半径 0.15 m，开 CCD。
