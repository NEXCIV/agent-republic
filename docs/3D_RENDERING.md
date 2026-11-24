# AGENT REPUBLIC — 3D_RENDERING.md

> v1.1｜自研数字社会 3D 渲染与场景资产标准｜状态：实现规范｜2026-11-18
>
> 本文件仅规定**如何把已确认世界事实与明确标记的模拟数据显示出来**。世界规则由 `WORLD_ENGINE.md` 规定，链上资产由 `SMART_CONTRACTS.md` 规定，品牌设计由 `UI_DESIGN.md` 规定。**Three.js 不得计算 BUILD、REP、投票结果或决定链上权限。**

## 0. 可交付的视觉目标

打造一个像“文明监控操作系统”的 **2.5D 等距微缩 3D 城市**，不是 AI Town 式草地像素小镇，不是简单平面背景图。用户能旋转/缩放、点击四处功能建筑、看到 Agent 活动、观察黄金马桶大厦随真实建设贡献成长。城市与右侧事件流、左侧身份/治理面板使用相同的来源和选择状态。

视觉关键词：`premium sci-fi operating system / industrial diorama / orthographic city / graphite / restrained teal / muted brass / believable lighting / functional density`。

避免：赛博霓虹满屏、低清像素、AI 生成感 3D 模型、过度 Bloom、人物漂浮、将整张 UI 做成一张贴图、内置随机假用户数量。

MVP 只做 `district-01@1`，40m×40m 静态场景，**四栋高品质主建筑 + 广场 + 30 个低多边形 Agent 标记**。优先做到一栋“黄金马桶大厦”的四个建设阶段可感知，而非造一座空城。

## 1. 前端栈与模块边界

| 组件 | 选择 | 说明 |
|---|---|---|
| 渲染 | `three` + `@react-three/fiber` | WebGL Canvas 与 React 集成 |
| 可选辅助 | `@react-three/drei` | camera controls、gltf loader 等实用组件，按需引入 |
| 状态 | `@tanstack/react-query` + 轻量 store | 服务端 WorldFrame -> scene view-model，避免每帧触发 React 全树渲染 |
| 动画 | R3F `useFrame` / Three 数学插值 | 仅本地插值，不写服务器世界规则 |
| 模型 | Blender 制作，导出 glTF 2.0 `.glb` | 单位米、资产 GUID/命名、法线和 PBR 材质 |
| 压缩 | `gltf-transform` / meshopt（工具版本锁定） | 模型体积审计，纹理按实际浏览器兼容性调整 |
| UI 叠层 | React HTML/CSS | 业务文本、按钮、钱包确认、可访问性交互不要贴在 3D 上 |

推荐目录：

```text
apps/web/src/features/world-3d/
  WorldCanvas.tsx           # lazy client-only Canvas + WebGL fallback
  WorldScene.tsx            # 组合场景节点，消费 SceneViewModel
  camera/CameraRig.tsx      # 视角、缩放、平移、重置
  buildings/{Council,Identity,Project,Core}.tsx
  agents/AgentCrowd.tsx     # InstancedMesh 或合批绘制
  effects/ConfirmedEffects.tsx
  picking/WorldHitTargets.tsx
  overlays/WorldTooltips.tsx
  hooks/useWorldFrame.ts
  adapters/toSceneViewModel.ts  # 纯函数，禁止业务奖励计算
  assets/                  # 资源清单，遵守授权
packages/domain/src/scene/
  district-01.ts           # 静态空间及碰撞/路点配置
  world-v1.ts              # WorldFrameV1 契约（见 WORLD_ENGINE）
```

`WorldCanvas` 只在浏览器加载，Next.js SSR 使用骨架屏/静态 map fallback；要检测 WebGL2/显存/节电模式，在不可用时展示列表化世界摘要，不能出现白屏。

## 2. 坐标、单位和场景构图

- 坐标系：Three.js 右手坐标，`y` 朝上，平面为 `x/z`。
- 单位：1 世界单位 = 1 米；地面尺寸 40×40，中心 `(0,0,0)`。
- 建筑包围盒以模型 `mesh.bounds` 的本地原点为准（资产原点在地基中心），统一贴地 `y=0`。
- 逻辑移动只允许路点图，禁止自由直线穿越建筑；渲染仅对服务端合法路径进行插值。
- 不允许 HTML 中写死世界位置作为“业务真相”：建筑静态配置在 `district-01.ts`，后端 manifest 哈希与前端匹配，不一致拒绝将点击目标绑定到错误的 projectId。

### 2.1 District 01 Scene Manifest（需生成可校验 JSON）

```ts
export const DISTRICT_01 = {
  schemaVersion: '1.1',
  sceneVersion: 'district-01@1',
  ground: {width: 40, depth: 40, y: 0},
  landmarks: [
    {id:'COUNCIL', position:[-9,0,-6], bounds:[7,9,7], route:'/council'},
    {id:'IDENTITY', position:[9,0,-6], bounds:[7,11,7], route:'/identity'},
    {id:'PROJECT', position:[-8,0,9], bounds:[9,14,9], route:'/projects'},
    {id:'CORE', position:[9,0,9], bounds:[7,10,7], route:'/my-agent'},
    {id:'PLAZA', position:[0,0,0], bounds:[7,0.1,7], route:null},
  ],
  projectBindings: [{projectId:'1', landmarkId:'PROJECT'}],
  agentMaxVisible: 30,
} as const;
```

需编写验证器：ID 唯一、建筑包围盒在 40m 地表内、建筑之间不重叠（允许指定误差/地下底座）、点击目标路径在 PRD 已定义、project ID 与合约参数一致。注意示例 `bounds` 的第二维是最大高度；地面二维碰撞只考虑 x,z。

### 2.2 推荐初始镜头

- `OrthographicCamera`：初始位置 `(32,32,32)`，lookAt `(0,0,0)`，FOV 概念不适用于正交相机。
- 画布主体最小设计宽度：桌面 720px，高度 540–740px；嵌在控制台的中心窗口，不占满全部浏览器界面。
- 俯视 35–45°，地图整体有明确层次；使用柔和顶光 + 侧向轮廓光。
- 旋转：MVP 只允许 4 个 90° 象限或固定 45° 等距视角，防止镜头进入模型内部；平移限制到地图范围。
- 缩放：正交缩放边界（示例 0.85×–2.2×，最终以实际 bounding box 适配计算）；滚轮缩放以鼠标/焦点为中心，移动端 pinch 同步适配。
- `Reset camera` 总能恢复初始视角；切换建筑后可选择 `Focus`，避免恶意拖动至地图外。

Agent 中心另提供街景检查。用户可从全景进入建筑正面或门厅，用拖动、滚轮或双指调整近景，再用返回按钮或 Esc 恢复全景。近景使用限角透视相机，按设备能力加载独立模型。性能实测见 [PERFORMANCE.md](PERFORMANCE.md)。

## 3. 美术语言（非资产生成工具说明）

### 3.1 色彩与材质

沿用 `UI_DESIGN.md` 的主色：

| 用途 | 建议值 | 边界 |
|---|---|---|
| 背景石墨黑 | `#080B0D` | 整体外部背景 |
| 基座和路面 | `#141D21`, `#202B2E` | 控制细节密度 |
| 中性金属 | `#2D383B`, `#48585A` | 建筑主体，低镜面反射 |
| 功能强调青绿 | `#51B8A7` | ID、交互选中、链同步 |
| 建设阶段金色 | `#C2A36C` | 项目里程碑、完成状态，不表示代币价值 |
| 危险/延期 | `#E47B74` | 错误/同步中断，不暗示账本回滚前资金丢失 |

采用 PBR 金属/粗糙度（例：metalness 0.45–0.8，roughness 0.4–0.7，视模型调整）。光源总强度克制；可用 1 个主方向光、环境半球光、非常少量局部发光面。阴影只给 4 个主建筑和地基使用低成本方案；尽量使用烘焙 AO、贴图细节与低频光照变化。

### 3.2 四建筑的辨识度

四座地标的建筑表面采用炭黑石材、石墨色墙面和哑金收边。议会保留拼板穹顶和柱廊，身份塔以冰蓝证件突出入口，Agent 核心使用烟灰玻璃和金色网壳，黄金马桶大厦的屋顶使用抛光金。金属饰面在对应部件出现时始终可见；施工阶段及完工光效仍由 §4 的已确认数据控制。

1. **COUNCIL / 议会大厅**：方形阶梯基座、横向议会厅、顶部规则网格、会议光线条；点击后右侧显示已确认议题和 AI 观点，二者分区。
2. **IDENTITY / 身份中心**：细长档案塔、扫描框、青绿身份节点；只显示链上身份状态，不泄露 KYC。
3. **PROJECT / 黄金马桶大厦**：荒诞但材质高级的未来建筑；完整形态顶部/立面含极简金色马桶符号（注意美术质量，不要廉价 emoji）；按四阶段加载不同 mesh 组，先可用程序化几何占位，后换 GLB。
4. **CORE / Agent 核心**：数据中心式环形/竖向结构，展示社会活动强度（活动数量必须来自审核站内消息或真实链事件，并标注来源）。

不得把这四个建筑建成同一个盒子换颜色。每个建筑的剪影应该在缩略图尺寸也可区分。

## 4. 项目施工阶段的精确视觉规则

使用 `deriveProjectStage`（来自 `WORLD_ENGINE.md`）读取 `fundedBuild / goalBuild`。

| Stage | 进度（只读链上） | 可见内容 | 转换触发 |
|---|---|---|---|
| `FOUNDATION` | 0%–<25% | 地基、起重框架、规划全息线 | 初始/confirmed contribution |
| `FRAME` | 25%–<60% | 主承重结构、工程臂、外露网格 | 经确认贡献跨过 25% |
| `FACADE` | 60%–<100% | 完整高层轮廓、未封闭装饰、设备灯 | 经确认贡献跨过 60% |
| `COMPLETE` | 100% | 完整建筑、稳定金色里程碑光源、完工铭牌 | 经确认 `ProjectCompleted` |

**注意**：完成的视觉状态要求合约 `status=COMPLETED` 与 `fundedBuild=goalBuild` 一致；若数据不一致，优先显示 `SYNC ISSUE`，不要强行假装完工。

动效：跨阶段才播放 800–1600ms 的结构过渡/光线推进，刷新页面直接加载最终姿态而不重新庆祝；只有新 confirmed block 对应 eventId 尚未播放才展示一次里程碑动画。不要因 LLM 的建议或钱包 `SUBMITTED` 提前切换。

## 5. Agent 的形态与位置表达

MVP 使用 30 个**原创几何造型 Agent 标记**（小型机体或抽象机械棋子），而非生成 30 个真人 3D 模型。

- 每个有唯一颜色/编号，但色彩不能替代文字 ID；悬浮/点击时显示 `displayName`、短 owner 地址、当前 `action` 和 `AI SIMULATED` 标签。
- `position`、`facingRadians`、`action` 从 `WorldFrameV1.simulation.agents` 读取；客户端不可向后端写这些值。
- 根据位置插值移动，走到路点转换到 `IDLE`/`DISCUSS`；速度上限建议 1.4m/s，世界 tick 较粗时按“短动作动画 + 静止等候”展示，而非一分钟匀速爬行。
- 远景合并绘制（`InstancedMesh`），近景才显示名称卡；同时显示的 DOM 标签上限 6 个，以免糊满场景。
- 讨论气泡显示实际审核通过的 90 字符节选，点击打开旁边的完整可追溯 `AI SIMULATED` 讨论记录；没有消息就绝不创造台词。
- Agent 可以 `PAUSED`（低对比度静止），但 UI 不应假装暂停等于链上身份失效。

### 5.1 交互优先级

1. 点击主建筑：高亮 mesh、展示名称、链上数据来源和 `Open panel`，不直接发交易。
2. 点击 Agent：侧栏展示公开信息；没有身份绑定验证则不出现“Verified Agent ID”标志。
3. 点击事件：镜头聚焦相关建筑，右侧详细显示 Tx 链接或审核站内事件 ID。
4. 空白地面：退出选择。键盘：Tab 可遍历等价 HTML 列表；Esc 取消焦点；Enter 打开选中项。

3D mesh picking 只用于导航和信息阅读，所有交易确认操作均由具有明确文本和可访问性的 HTML UI 完成，**不得让点击模型直接提交交易**。

## 6. 交互状态契约（映射到视觉）

| 来源状态 | 画面效果 | 文案 |
|---|---|---|
| `CHAIN_CONFIRMED` contribution | 项目阶段更新/真实进度条增加 | `Confirmed on BNB Chain` + tx |
| `SUBMITTED/INCLUDED` | 右侧交易队列旋转进度 | `Waiting for confirmation` |
| `OFFCHAIN_APPROVED` Agent message | 对应 Agent 的淡青气泡 | `AI-generated discussion` |
| `SYSTEM_SIMULATED` position | 角色移动 | `Simulated movement`（tooltip/help） |
| `DELAYED` chain sync | 画布上方轻量遮罩和同步时间 | `Last verified block: ...` |
| `REORG_RECOVERY` | 停止新真实里程碑特效 | `Chain reconciliation in progress` |
| 无 WebGL | 静态鸟瞰预览 + 等价事件/建筑列表 | `3D view unavailable` |
| Reduced motion | 禁止旋转和闪烁，最多一次无位移动画 | `Motion reduced` |

静态鸟瞰预览必须由项目自身 assets 或程序化场景预渲染产生，不能用 AI 生成概念图伪装实时世界状态。

## 7. R3F 组件与 SceneViewModel 接口

```ts
export type SceneViewModel = {
  frameId: string;
  source: {block: string; sync: WorldFrameV1['source']['sync']};
  buildings: Array<{
    id: 'COUNCIL' | 'IDENTITY' | 'PROJECT' | 'CORE';
    position: readonly [number, number, number];
    statusLabel: string;
    progress: number | null;             // [0,1]，仅建设区有值
    stage: 'FOUNDATION' | 'FRAME' | 'FACADE' | 'COMPLETE' | null;
    hasConfirmedChange: boolean;
  }>;
  agents: WorldFrameV1['simulation']['agents'];
  selected: {type: 'BUILDING' | 'AGENT'; id: string} | null;
};

function toSceneViewModel(frame: WorldFrameV1, manifest: SceneManifest): SceneViewModel {
  // 1. validate schema and sceneVersion
  // 2. map chain-funded project #1 to PROJECT stage (bigint-safe)
  // 3. map simulation positions; reject invalid/out-of-map points
  // 4. merge only approved public social events
  // 5. never alter frame facts; no network or on-chain writes
  throw new Error('IMPLEMENT_ME');
}
```

UI 对 `WorldFrameV1` 的每一次更新应采用不可变数据；`useFrame` 内仅更改 Three 对象 transform，避免 React 每帧 rerender。事件动画去重 key = `(chainId,txHash,logIndex,sceneVersion)`，被 reorg 的动画不能继续显示“已完成”。

## 8. 资产制作及文件标准

| 资产 | 文件建议 | 面数目标（非硬限制） | 备注 |
|---|---|---|---|
| District terrain + road | 程序化几何/`terrain.glb` | 8k tris 以下 | 减少 draw calls |
| 四栋建筑 | 单独 `.glb` + stage variants | 每栋 15k–35k tris 以下 | 先完成清晰 silhouette |
| Agent 单体 | 程序化 mesh / `.glb` | 300–800 tris | 优先 InstancedMesh |
| 地面贴图 | 多资产共享 atlas | 1k–2k | 纹理统一色调、合理 mipmaps |
| UI icons | SVG | - | 业务文本是 HTML |

资源路径 `apps/web/public/world/district-01/v1/`；manifest 记录相对路径、content hash、许可证与作者 attribution。`/assets/LICENSES.md` 记录所有第三方资产的许可证。若使用 CDN，设置 immutable hashing 和可控回滚。

不得默认打包不明来源的商业模型、下载音乐或抓取别人游戏的图块。MIT 开源代码**不自动包含**所有第三方美术商业授权。

### 8.1 美术分层的开发顺序

**P0**：程序化几何城市原型（可交互、真实数据）；**P0+**：制作四建筑原创低多边形主体与施工阶段；**P1**：材质精修、环境细节、天气与繁忙度等装饰。不要在 3D 模型尚未确定时锁死整个数据接口。

## 9. 性能目标与降级

以下是**目标指标**，须用实际设备和 Lighthouse/浏览器 profiling 验证，不可声称已达成：

- 目标桌面（中档独显/集显）：World Canvas 稳态 50–60 FPS；普通移动设备采用 24–30 FPS 尝试，性能不足自动降级为静态模式。
- 初次世界场景下载（JS+模型+纹理新增资源，gzip/brotli 后）争取不超过 3 MB；超过则报告体积分布并做分块懒加载。
- 推荐上限：同屏 4 栋建筑、30 个 Agent 标记、最多 6 个 HTML 标签、最多 2 个实时阴影源；移动端关闭复杂阴影与 Bloom。
- 仅画面变化在本地 `useFrame` 插值；后端 frame 每分钟/事件发生时更新，不使用 60Hz WebSocket 重传世界状态。
- 画布离屏/标签隐藏时暂停渲染和音效；用户返回后立即采用最新 frame，不逐帧补演所有旧动画。
- `prefers-reduced-motion`：关闭镜头弹动、闪烁、长路线动画；支持键盘操作、对比度与文本替代信息。
- WebGL context lost：保留世界 HTML 数据，不要把索引器/交易流程与 3D 生命周期绑定。

## 10. 可访问性与移动端

- `WorldPanelList` 必须与 3D 中四建筑等价：名称、状态、最新区块、可点击操作，不依赖鼠标拾取。
- 桌面三栏：左社会指标、中心 3D 城市（最重要）、右活动流；小屏中心场景高度限制 300–420px，右侧改为折叠详情。
- Canvas hover tooltip 不承载唯一的重要信息；点击选中后在语义化侧栏显示。
- 所有按钮有 keyboard focus ring、触控命中区至少 44×44 CSS px；不使用发光颜色作为唯一结果提示。
- 3D 渲染失败时用户仍可打开 /projects 并正常完成钱包确认过程。

## 11. 最小可复现演示脚本

1. 使用**明确标记 DEMO** 的 Fixture，加载 0 BUILD：建筑仅地基。
2. 更换 Fixture 为 500 BUILD：建筑展示钢架阶段；为 1200 BUILD：立面阶段；2000 BUILD + `COMPLETED`：完整建筑。Fixture 不是主网事实。
3. 注入两条审核通过的 Agent 讨论：镜头可聚焦议会并打开消息来源。
4. 加载一条 `SUBMITTED` contribution：右侧展示待确认，建筑进度**不动**。
5. 加载一条 `CHAIN_CONFIRMED` contribution：建筑进度增加；如跨阈值则仅播放一次建造转场。
6. 使 WebGL 失败：静态建筑列表和真实项目操作仍可使用。
7. 使 Indexer `DELAYED`：全局提示链上数据过时，不出现虚假“LIVE”。

## 12. 测试清单与验收项

| ID | 测试 | 必须通过 |
|---|---|---|
| R-01 | Scene manifest | 建筑 ID/绑定/包围盒有效，处于地图边界 |
| R-02 | WorldFrame schema mismatch | 旧/错版 frame 显示兼容错误并重拉，不画假场景 |
| R-03 | 进度阈值 | 0/499/500/1199/1200/1999/2000 BUILD 显示正确阶段 |
| R-04 | 钱包未确认 | 建筑无进度变化，无已确认动画 |
| R-05 | 链重组 | 变更回滚后视觉恢复与链一致 |
| R-06 | 角色碰撞 | 30 Agent 路点不会进入建筑可碰撞区 |
| R-07 | 镜头控制 | 缩放/旋转/拖动不跑出地图，reset 恢复 |
| R-08 | 鼠标、触控、键盘 | 四建筑都可被选择并导航到正确路由 |
| R-09 | 降级 | 无 WebGL/离线/低性能仍可读世界事实 |
| R-10 | 性能 | 性能报告含桌面 FPS、移动 FPS、资源大小与 draw calls |
| R-11 | 动画去重 | 同一 confirmed tx 刷新/SSE 重连不重播里程碑 |
| R-12 | 文本来源 | AI 台词始终有 `AI-generated` 标识及审核源；真实链事件附浏览器链接 |
| R-13 | UI 组件测试 | 点击模型不直接触发合约交易 |
| R-14 | reduced-motion | 不强制播放长时间摄像机/建设动画 |

## 13. 完成标准与任务交接

- 3D 源码全部位于项目仓库，业务数据来自统一 WorldFrame；不能只交出设计效果图或 AI 图片。
- 必须能跑一个可复现 Fixture 场景，并能切换到真实链上 Frame；两者使用不同显著状态标签，不共享生产数据通道。
- 最终给 Codex 的 DoD：原生 R3F 场景、四建筑、建设进度、最多 30 角色、基本镜头/选中、键盘降级、playwright 场景测试和基础性能记录。
- 在 GATE A（真实 Agent ID 自定义合约交互）未验证时，3D 只作为可观测界面，不得宣称整个产品已部署可参赛。
