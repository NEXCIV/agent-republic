# Blender 建模管线设计 — 低多边形精装档

> 日期：2026-11-20｜状态：设计已评审通过（用户确认）｜对应 3D_RENDERING.md §8.1 的 P0+ 阶段

## 1. 背景与目标

`apps/web/src/features/world-3d/` 目前使用程序化 R3F 几何渲染 District 01（P0 阶段）。本设计将其升级为 Blender 制作的低多边形 GLB 资产（P0+），并让 Agent 以低多边形小人形象出现，保持现有交互、性能与降级路径不变。

## 2. 已确认决策

| 决策点 | 结论 | 备注 |
|---|---|---|
| 美术风格 | 低多边形卡通风 | 配色保留石墨深底 + 青绿 #51B8A7 + 哑金 #C2A36C，与 UI 色板连续 |
| Agent 造型 | 低多边形小人（类人市民） | 替换现有六棱锥标记 |
| 生产方式 | bpy 脚本全自动生成 | Blender 5.3 便携版位于 `G:\blender`，无头模式已验证可行 |
| 范围 | 精装档 | 建筑 + Agent + 广场铺装/街道/路灯 + 绿化/氛围件（飞艇等） |
| Agent 动画 | 分部件 + 程序化摆动（路线二） | 部件命名骨骼兼容，未来可升级 Armature 骨骼动画（路线一） |

## 3. 资产清单（bpy 脚本产出）

| 文件 | 内容 | 预算 |
|---|---|---|
| `council.glb` | 议会大厅低模 | 5k–15k tris |
| `identity.glb` | 身份中心低模 | 5k–15k tris |
| `core.glb` | Agent 核心低模 | 5k–15k tris |
| `project.glb` | 黄金马桶大厦，单文件内 4 个命名组 `stage_foundation` / `stage_frame` / `stage_facade` / `stage_complete`，运行时切换 visible | ≤35k tris |
| `agent-citizen.glb` | 小人，部件命名 `body` / `head` / `legL` / `legR` / `armL` / `armR`；腿部对象原点设在髋部便于摆动旋转 | 300–800 tris |
| `environment.glb` | 广场铺装、路点街道、路灯、绿化、氛围件 | ≤8k tris |

- 全部平涂材质（Principled BSDF 导出 glTF PBR），无贴图，体积小。
- 输出目录：`apps/web/public/world/district-01/v1/`。
- 同目录维护资产 manifest：相对路径、content hash、tris 数、原创自研声明；`/assets/LICENSES.md` 标注原创。

## 4. 脚本组织

- `tools/blender/build_assets.py`：主脚本，建模 + 材质 + 导出 GLB。
- 运行方式：`G:\blender\blender.exe --background --python tools/blender/build_assets.py`。
- 建筑尺寸常量从 `packages/domain/src/scene/district-01.ts` 抄录，注释标注来源（manifest 不可变）。
- 材质色值对齐 `apps/web/src/features/world-3d/buildings/palette.ts`。
- `.blend` 源文件一并入库，保证可复现，且用户日后可在 Blender GUI 精修后重新导出替换。

## 5. three.js 接入

### 建筑

- 新增加载层：手写 loader hook（`three/examples/jsm/loaders/GLTFLoader.js`，位于 `world-3d/assets/`），不引入 drei，避免新增依赖。
- `LandmarkModel` 保持现有点击 / 选中 / 相机聚焦逻辑，GLB 到位后替换程序化几何。
- **程序化几何保留为 fallback**：GLB 加载完成前显示现有程序化版本；加载失败也回退——不白屏、不阻塞。
- PROJECT 阶段：按现有 `stage` prop 切换 4 个命名组 visible，保留 800–1600ms 阶段过渡动画与里程碑动画去重逻辑。

### Agent（AgentCrowd 改造）

- 从 `agent-citizen.glb` 提取各部件几何，**每部件一个 `InstancedMesh`**（保留合批，性能与现状一致）。
- 移动时腿部绕髋部程序化摆动（每帧写实例矩阵），静止时轻微上下浮动。
- 保留：唯一颜色区分（instanceColor）、选中金色光环与 1.35× 放大、不可见拾取球、reduced-motion 直接落位、demand 渲染循环。
- 骨骼升级预留：部件命名与层级与未来 Armature 兼容，升级时仅替换渲染层。

### 环境

- `environment.glb` 静态加载放置；飞艇等氛围件由代码做轻微位移动画（无骨骼）。

### 性能预算

- 模型总体积 ≤1.5MB（3D_RENDERING.md §9 的 3MB 总预算一半留给 JS）。
- 无贴图、无骨骼 mixer、无新增光源；demand 循环保留。
- 若超标：gltf-transform（weld/prune）优化或氛围件分批懒加载。

## 6. 约束遵守（AGENTS.md / 3D_RENDERING.md）

- 场景 manifest `district-01@1` 不变；GLB 按 manifest bounds 建模。
- GLB 纯视觉资产，不携带业务数据；渲染端只有显示权。
- `AI SIMULATED` / `ON-CHAIN CONFIRMED` 标签逻辑不动。
- HTML 世界目录继续作为无 WebGL 权威视图。
- 模型 100% 原创脚本生成，无第三方版权资产。

## 7. 测试与验收

- GLB 加载失败 → 回退程序化版本（不白屏）。
- PROJECT 4 阶段切换正确（0/25/60/100% 阈值）。
- 体积审计：脚本报告每个 GLB 的大小与 tris。
- 更新受影响的视觉测试断言（R-01..R-14），回归：lint / typecheck / build / test:visual / test:responsive / test:a11y。

## 8. 交付批次（每批独立可验收）

1. **批次 1**：小人 GLB + AgentCrowd 多部件改造（最直观提升）。
2. **批次 2**：四栋建筑 GLB（含马桶大厦 4 阶段）+ 程序化 fallback。
3. **批次 3**：环境精装（铺装 / 街道 / 路灯 / 绿化 / 氛围件）。

## 9. 未来升级路径

- Agent 骨骼动画（路线一）：在 .blend 中为小人加 Armature + walk/idle 动画，导出带 animation 的 GLB，渲染层换 `SkinnedMesh` + `AnimationMixer`（放弃合批，约 30 draw calls）。
- 用户手工精修：打开 .blend 调整后重新导出，content hash 更新即生效。
