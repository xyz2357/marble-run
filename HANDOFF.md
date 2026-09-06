# HANDOFF — Marble Run（2026-09-06）

给下一段对话 / 下一个 Claude 会话的交接。读完这个 + README.md + PLAN.md 就能接着干。

## 当前状态

- 本地 git，master，tag `stage-0` … `stage-4c`。无远端（gh 已登录 xyz2357，**推 GitHub 前必须问用户**）。
- `npm run dev` → http://localhost:5173；`npm test` → 34 条 Playwright 全过（workers=2，timeout 90 s；整套并发 4 会因机器慢而误报超时）。
- Stage 0–4 完成（29 种零件 / 20 个零件栏条目，鸡蛋弹珠，3 条示例轨道）；Stage 5 未开始。

## 用户偏好（重要）

- 中文交流。要求"先 plan 分 stage"，后来说"根据你的节奏来，一次可以多做一点"——一轮可跨多项，但每个里程碑 commit + tag + 截图 + 汇报。
- 用户会亲自试玩并给手感反馈（曾因"3D 摆放不顺手"改成接龙模式为默认；因"音效像小鸟"重做了音效；因"木琴不像木琴"重做成独立长条键）。
- 物理问题不要猜：用逐帧采样 / 接触点探针（seam 里有 `contacts(id)`、`topView`、`lookAt`）定位根因再改。

## 架构速览

- `src/geometry/sweep.ts`：截面沿路径扫描；`TRACK_PROFILE` 是圆弧槽（R 0.45）+ 护栏 0.22；`sweep(path, segs, profile | profile(t))` 支持截面渐变；`lerpProfile`、`bezierPath`、`pathSub`、`capTriangles`（容忍坍缩点）。
- `src/pieces/*`：每个零件 `PieceDef { id, name, family?, footprint, heightUnits, ports, build() }`；`family` 把同一零件的不同规格（helix/helix2/helix3、lift4..10、gate_fast/gate/gate_slow、wheel/wheel_fast、splitter/splitter_rnd）归为一族：`registry.paletteDefs()` 每族只出一个条目，`variantsOf()` 列出成员，编辑器 `setVariant/cycleVariant`（V 键、顶部规格条、选中面板"规格"按钮）原地替换。存档格式不变（version 1，直接存成员 id）。`build()` 返回 `parts`（渲染 + trimesh 碰撞体，可 `collide:false`、可 `color`）、`preview`、`spawn`、`goal`、`mechanisms`（运动学/动态刚体 + 每步 `update(dt, marbles)`）。注册表 `registry.ts`，前 12 个有快捷键。
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
- **运动学夹球会把弹珠弹飞（几米远）**：水车前墙底边曾贴着轮缘，坐在叶尖上的球被叶片顶着墙挤飞——前墙底边必须高出轮缘一个球径；分叉翻板在后一颗球还在翻板区时翻转会把它夹飞——`pendingFlip` 等区域清空再翻；跳台凹槽进两颗球会把后一颗斜着踢出侧墙——加了计量闸门（有球在凹槽或按钮未复位就关）。测试里 `setMode('play')` 会先放一颗，再 `spawnBurst` 就会有两颗几乎重叠出发，这是很好的压力测试。
- `ringShell(center, rIn, rOut, halfZ, a0, a1)` 走的是从 max(a0,a1) 递减到 min 的方向；要绕过底部（经 180°、270°）时终点角要写成 320° 而不是 −40°。
- 撞击式机关（跳台按钮）不要做成随托盘平移的大部件：托盘弹出去那 0.5 s 后面的球会掉进坑里。静止凹槽 + 短冲程按钮没有会张开的缝。
- 跳台入口用贝塞尔曲线切线连续地弯进 35° 槽：直接接斜槽的话 2 m/s 的球会飞过槽落在挡唇上。
- Bash heredoc 里 `\n`、引号会被工具转义/破坏：多行脚本用 Write 写成 `scratch/*.py` 再 `python` 运行（scratch/ 已 gitignore，`tools/` 是要保留的脚本）。

## 后面要做的（按优先级）

1. ~~Stage 4 剩余零件~~ 已完成（stage-4c）。可选的后续零件点子：计数分流（每 3 颗换一边）、多米诺、环形跳跃 loop、连续参数（弯道半径/长度拖动调整，需要存档 version 2 带 params）。
2. **多口零件的"自动铺路"**：用户说先不做，留着。
3. **合流手感**：合流处仍有一次撞外侧护栏（~10–20% 掉速），可接受；若要改进考虑更长的 Y。
4. **Stage 5**：预置关卡 5 条（现有示例 1/2）、URL 分享（JSON 压缩进 hash）、手机触控、视觉打磨（漏斗外形像圆桌、电梯塔是纯黑方柱、可考虑木纹贴图）、部署（GitHub Pages / Netlify，**部署和 push 前先问**）。
5. 小事：示例 3 里水车出来的球很慢，分叉后必须继续下坡（平弯道会停）；鸡蛋在跳台/水车上没测过。鸡蛋脸贴图原图只有 128 px 略糊（用户给大图后重跑 `tools/make_egg_skin.py`）；起点小旗、终点等外观可再精细；`levels/` 目录还是空的（示例轨道目前由 `src/game/demo.ts` 用代码接龙生成）。
