# HANDOFF — Marble Run（2026-09-05 晚）

给下一段对话 / 下一个 Claude 会话的交接。读完这个 + README.md + PLAN.md 就能接着干。

## 当前状态

- 本地 git，master，HEAD = `cdec1dc`，tag `stage-0` … `stage-4b`。无远端（gh 已登录 xyz2357，**推 GitHub 前必须问用户**）。
- `npm run dev` → http://localhost:5173；`npm test` → 29 条 Playwright 全过（workers=2，timeout 90 s；整套并发 4 会因机器慢而误报超时）。
- Stage 0–3 完成；Stage 4 完成两批零件 + 鸡蛋弹珠；Stage 5 未开始。

## 用户偏好（重要）

- 中文交流。要求"先 plan 分 stage"，后来说"根据你的节奏来，一次可以多做一点"——一轮可跨多项，但每个里程碑 commit + tag + 截图 + 汇报。
- 用户会亲自试玩并给手感反馈（曾因"3D 摆放不顺手"改成接龙模式为默认；因"音效像小鸟"重做了音效；因"木琴不像木琴"重做成独立长条键）。
- 物理问题不要猜：用逐帧采样 / 接触点探针（seam 里有 `contacts(id)`、`topView`、`lookAt`）定位根因再改。

## 架构速览

- `src/geometry/sweep.ts`：截面沿路径扫描；`TRACK_PROFILE` 是圆弧槽（R 0.45）+ 护栏 0.22；`sweep(path, segs, profile | profile(t))` 支持截面渐变；`lerpProfile`、`bezierPath`、`pathSub`、`capTriangles`（容忍坍缩点）。
- `src/pieces/*`：每个零件 `PieceDef { id, name, footprint, heightUnits, ports, build() }`；`build()` 返回 `parts`（渲染 + trimesh 碰撞体，可 `collide:false`、可 `color`）、`preview`、`spawn`、`goal`、`mechanisms`（运动学/动态刚体 + 每步 `update(dt, marbles)`）。注册表 `registry.ts`，前 12 个有快捷键。
- `src/game/track.ts`：放置/删除、接口配对、`snapSolutions`、`canPlace`（拒绝重叠和地下）、`ChainBuilder`（`begin/add/from`）。
- `src/editor/editor.ts`：接龙模式（橙点 = 当前接口，数字键选零件，Enter 放置，R 换接法，Backspace 撤销，倒着铺、合拢检测）+ 自由模式 + 选中编辑（旋转/升降/平移/删除面板）+ 相机（WASD、预设视角、F 聚焦）+ 自动存档 localStorage + 导入导出 JSON。
- `src/game/game.ts`：固定步长 1/120，`step(n)` 里先 `track.update` 再物理；生成队列、连发、比赛计时排名、跟随相机、慢动作；`marbleShape` 圆球/鸡蛋。
- `src/game/audio.ts`：Web Audio 合成——棕噪声滚动声、木头"咚"碰撞声、木琴音符；离线频谱测试保证不"像小鸟"。
- `src/test-seam.ts`：`window.__TEST__`，Playwright 用它驱动一切。测试在 `tests/stage*.spec.ts`。

## 已知坑（都已修，别再踩）

- Rapier trimesh 开 FIX_INTERNAL_EDGES 后对三角形朝向敏感：车削（Lathe）轮廓方向反了弹珠会穿进实体贴外壳滚（漏斗 vs 漩涡碗的轮廓方向相反，见代码注释）。
- 同一碰撞体里不能叠放两块甲板（边界边 = 幽灵碰撞）；分叉/合流是一个沿 X 变化的 30 点截面一次扫出（W 形叉口）。
- 坍缩成零面积的三角形被删掉会留下边界边（主道中线幽灵边）：坍缩的点要平摊在真实表面上，不能重合。
- 弹珠 `canSleep(false)`（运动学门离开后不会唤醒睡眠体）；闸门/电梯门有弹珠压着时不升起。
- 平直段会让慢速弹珠/鸡蛋停住：能做成下坡的零件都做成下坡（分叉、合流、电梯出口、螺旋全程连续下降）。
- 落管下沿离出口槽要 ≥ 弹珠直径，落地区加围栏。
- 跷跷板支柱顶不能碰到板底；翻转后出口端要高出下一块 3 cm。
- Bash heredoc 里 `\n`、引号会被工具转义/破坏：多行脚本用 Write 写成 `scratch/*.py` 再 `python` 运行（scratch/ 已 gitignore，`tools/` 是要保留的脚本）。

## 后面要做的（按优先级）

1. **Stage 4 剩余零件**：弹簧跳台（运动学拍板弹射 + 宽落点）、随机分叉器（复用 splitter，随机选边）、旋转风车、可调参数零件（选中面板里改螺旋圈数 / 电梯层数等——需要 PlacedPiece 带 params 并进存档格式 version 2）。
2. **多口零件的"自动铺路"**：用户说先不做，留着。
3. **合流手感**：合流处仍有一次撞外侧护栏（~10–20% 掉速），可接受；若要改进考虑更长的 Y。
4. **Stage 5**：预置关卡 5 条（现有示例 1/2）、URL 分享（JSON 压缩进 hash）、手机触控、视觉打磨（漏斗外形像圆桌、电梯塔是纯黑方柱、可考虑木纹贴图）、部署（GitHub Pages / Netlify，**部署和 push 前先问**）。
5. 小事：木琴脸贴图原图只有 128 px 略糊（用户给大图后重跑 `tools/make_egg_skin.py`）；起点小旗、终点等外观可再精细；`levels/` 目录还是空的（示例轨道目前由 `src/game/demo.ts` 用代码接龙生成）。
