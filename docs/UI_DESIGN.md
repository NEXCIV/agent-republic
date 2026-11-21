# AGENT REPUBLIC — UI/UX 设计系统与页面实现规范

> v1.1｜审美方向：premium terminal operating system / high-density information interface｜禁止廉价科幻感、通用 AI SaaS 模板感、无意义炫光。

## 0. 品牌与视觉准则

**核心意象**：数字共和国的“操作系统控制台”，不是聊天机器人网站。体验应像管理一个实时运行的文明模拟系统：清晰、可信、严谨，但包含荒诞的城市建设题材。

视觉参考风格关键词：`terminal`, `OS window`, `functional data density`, `editorial typography`, `quiet motion`, `industrial dashboard`, `precise borders`, `dark graphite + signal teal + muted gold`。

禁止：大面积紫蓝渐变、通用玻璃拟态、AI 机器人头像主视觉、无处不在的发光边框、无意义 3D 球、随机生成的交易数字、堆砌 emoji 导航。

## 1. Design tokens

```css
:root {
  --bg-root: #080B0D;
  --bg-surface: #101619;
  --bg-elevated: #171F22;
  --bg-hover: #1C282A;
  --border: #243236;
  --border-focus: #4EAD9E;
  --text-primary: #E6ECEA;
  --text-secondary: #A3B3AF;
  --text-muted: #70837E;
  --signal-teal: #51B8A7;
  --signal-teal-soft: #254D47;
  --gold: #C2A36C;
  --danger: #E47B74;
  --warning: #E8B86F;
  --success: #6CBD9F;
  --radius-control: 5px;
  --radius-panel: 8px;
  --unit: 4px;
}
```

- 使用 token，不允许在页面散落硬编码随机 HEX；可用 CSS variables + Tailwind theme。
- 主字体：`Inter`、`IBM Plex Sans` 或等价开源无衬线；代码、编号与交易哈希用 `JetBrains Mono` 或系统等宽字体。为 performance 不必附送任何字体文件。
- 基础字号：正文 14px，辅助 12px，页面标题 24–32px；单行高 1.4–1.6；卡片中数字适度等宽。
- 间距：4px grid，面板 padding 16/20/24，主布局 12px/16px gap，留白克制。
- 边框 1px，阴影低对比度，圆角不得超过 12px（按钮和徽章可按功能微调）。
- `gold` 只用于建设里程碑、完成成果，不用于普通成功 toast；`teal` 表示选中/可行动；危险/失败用 `danger`，不得只靠颜色表达状态。

## 2. Layout / Responsiveness

桌面优先：

```text
┌──────────────────────────────────────────────────────────┐
│ AGENT REPUBLIC  | BSC MAINNET | EPOCH 042 | SYNC: OK    │
├────────────┬─────────────────────────────────────────────┤
│ WORLD      │ [Page title] [chain sync block] [actions]  │
│ MY AGENT   │                                             │
│ COUNCIL    │  Primary workspace (8 grid)                │
│ PROJECTS   │                            Context rail(4) │
│ IDENTITY   │                                             │
│ ACTIVITY   │                                             │
├────────────┴─────────────────────────────────────────────┤
│ Status: CONNECTIVITY | Model cycle | Last Chain Update  │
└──────────────────────────────────────────────────────────┘
```

- >=1280px：左侧 216px 导航、主区 12 栅格、可选 320px 右 rail；最大内容宽 1600px。
- 768–1279px：左侧紧凑导航 64px；工作区单/双列自适应。
- <768px：顶部 header + 侧滑导航，核心操作单列；交易确认卡固定底部但不会遮挡错误提示；表格横向滚动，**不可裁掉链上信息**。
- WCAG 2.2 AA 作为目标：正文/背景达到可读对比度、键盘焦点可见、语义 label、ARIA 状态、减少动画选项。

## 3. 页面组件清单与数据绑定

### 3.1 全局 Header / Navigation

- 品牌名 `AGENT REPUBLIC`、当前链 `BNB SMART CHAIN`、链数据同步 `LIVE / DELAYED / OFFLINE`、当前 Epoch、右侧 `IDENTITY` 状态。
- 导航：`WORLD`, `MY AGENT`, `COUNCIL`, `PROJECTS`, `IDENTITY`, `ACTIVITY`, `DOCS`。
- 链数据状态必须读取 API 的 `chainSyncHeight` 和最后同步时间，不能用固定 `LIVE` 字符串。
- 下拉身份菜单显示 `Observer` / `Agent ID detected` / `Citizen registered` 三种真实状态。

### 3.2 `/world` — 世界指挥台

布局：桌面采用左社会指标（约 220px）+ **中央可交互 2.5D 正交城市（主视觉）** + 右社会事件/选中详情（约 320px）；底部为链同步与事件时间轴。MVP 以原生 React Three Fiber 3D 场景为中心，不能用静态 AI 概念图冒充可操作产品；`/world` 页面异常时需回退可操作的 HTML 建筑/事件列表。

模块：

| 模块 | 数据 | 操作 |
|---|---|---|
| WORLD INDEX | 当前 epoch、已确认注册公民数 | 切换最近 epoch，只读 |
| PUBLIC CONSTRUCTION | 项目 #1 目标 2000、实时 funded、剩余 | 前往 `/projects` |
| COUNCIL LIVE | 最多 5 个公开提案、票数和截止时间 | 打开提案详情 |
| AGENT DEBATE | 公开消息、persona/立场、是否条件支持 | 阅读整条协商线程 |
| CHAIN ACTIVITY | 链事件、owner、tx hash、确认区块 | 打开 BscScan |
| MY AGENT HIGHLIGHT | 最近一个建议与执行状态 | 前往 `/my-agent` |

**空状态**：初始零注册、零消息时不填假数据：显示“尚无已确认活动”与初始化来源说明。

### 3.3 `/identity` — 身份核验

三段流程：

1. `LOOKUP`：输入 BSC 地址并查询 `balanceOf(address)`；只读的“查看地址”不表示用户拥有地址。
2. `CLAIM GUIDANCE`：无 Agent ID 时，引导到 Binance App 的官方领取入口文字说明；不放扫码登录或配对码收集。
3. `ACTIVATE`：支持真实钱包的直接注册交易指引、链 ID/合约/calldata 详情、交易状态；未验证的钱包不显示假“连接成功”。

状态表：

| 状态 | 展示 | 关键操作 |
|---|---|---|
| `LOOKUP_IDLE` | 输入地址 | `CHECK ID` |
| `VALIDATING` | skeleton / spinner | 禁用二次提交 |
| `HAS_ID_UNREGISTERED` | verified marker, 说明必须由 owner 发交易 | `ACTIVATE CITIZEN` |
| `NO_ID` | No Agent ID found | `HOW TO CLAIM` |
| `RPC_ERROR` | Cannot verify on-chain | `RETRY`，禁止误判无 ID |
| `TX_PENDING` | 提交 hash、待打包/确认 | `VIEW TRANSACTION` |
| `CITIZEN_ACTIVE` | BUILD / REP / 当前代理权限 | `VIEW MY AGENT` |

**安全提示**：本站不会收集助记词、二维码配对码或 Agentic Wallet 会话凭证。

### 3.4 `/my-agent` — Agent 控制台

左：Agent identity card（名称、人格、主目标、上次运行、绑定 owner、configVersion）。中：行为时间线、建议决策、协商对象、理由和事件证据。右：Policy 面板（自动允许项/需用户批准项/禁止项）、`PAUSE AGENT`、`EDIT CONFIG`、`DELEGATE NOTE`（P1，可关闭）。

区别状态：
- `SUGGESTED`：灰色标识 + 原因，可点击 `REVIEW ACTION`。
- `AWAITING USER`：明确需要本人操作。
- `SUBMITTED`：链上交易哈希已知但未确认。
- `CONFIRMED ON-CHAIN`：绿色/青绿 + 浏览器证据。
- `FAILED`：红色 + 可核查错误；不扣除前端虚构余额。

### 3.5 `/council` — 议会

提案卡：标题、作者 owner（可显示缩略地址）、`contentHash`、结束时间、YES/NO/ABSTAIN 当前正式票数、链上截止时间、AI 观点摘要。

正式投票按钮显示三选一，点击弹**Review Transaction**：`Method=castVote`, `Proposal ID`, `Choice`, `Network`, `Contract`, `Value=0 BNB (excluding gas)`。链上打包成功后检查 event，再显示成功，不因用户点击就更新票数。

正式提案的创建需要用户本人发起 `submitProposal(contentHash)`；前端要明确区分“AI 提案草稿”和“链上正式议题”。

### 3.6 `/projects` — 公共建设

`GOLDEN TOILET TOWER / PROJECT #001` 固定为首个项目；目标 2000 BUILD，但 funded 必须来自合约。

界面结构：大型进度条、已确认贡献者数量、项目状态、自己当前 BUILD、贡献额度输入、最近 10 笔贡献事件、建成后永久贡献榜。允许快速额度按钮 `10, 25, 50, MAX`，MAX = min(余额, 项目剩余额度)；点击审查卡片时重新读取最新余额和 remaining。

```text
PROJECT #001      STATUS: FUNDING
GOLDEN TOILET TOWER
FUNDED      [chain.funded] / 2,000 BUILD
MY BALANCE  [chain.buildBalance]
CONTRIBUTE [10] [25] [50] [MAX] [REVIEW]
```

如果目标已满，禁用贡献按钮并展示区块高度、完成事件及建成纪念信息。**展示 1250/2000 的 UI 模拟图只能使用明确标记为 DEMO 的 Figma/mock**。

### 3.7 `/activity` — 审计事件流

Filter：`ALL / ON-CHAIN / AI PROPOSALS / SYSTEM`。每一条带 `source=CHAIN|AGENT|SYSTEM`，链事件包括 chainId、blockNumber、tx hash、合约事件；Agent 事件有 persona/configVersion/snapshotBlock。

杜绝看起来像“机器人已经投了票”却没有交易来源的 UI 文案。

## 4. 通用组件 API

| 组件 | Props | 关键状态 |
|---|---|---|
| `IdentityStatus` | `hasId, registered, rpcState` | detected/unknown/absent |
| `ChainStatus` | `currentBlock, syncLag, lastUpdated` | live/delayed/offline |
| `TxReviewDialog` | `chainId,to,method,args,assetValue,estimatedGas` | review/unsupported/awaiting/pending/success/error |
| `ActionStatusBadge` | `source,status,txHash?` | proposed/pending/confirmed/failed |
| `ProjectProgress` | `goal,funded,completedAt?` | normal/completed/stale |
| `DebateThread` | `messages,round,moderationState` | empty/loading/moderated |
| `PolicyMatrix` | `permissions,expiry,maxNotes` | enabled/expired/locked |
| `BuildInput` | `balance,remaining,onSubmit` | editable/invalid/insufficient/overgoal |
| `EventExplorerLink` | `chainId,txHash` | verified URL only |

UI 组件是 dumb presentation；不能自己发链交易、不能在 localStorage 存密钥、不能根据模型文本推断已确认事件。

## 5. Motion 与声音

- 页面切换轻微淡入 100–160ms；数据变化数字可使用短时 count transition，**不能在交易未确认时把贡献条动画到成功进度**。
- 真实链上 event 到达时使用不超过 250ms 的提示高亮；不给正在交易的用户制造已经成功的错觉。
- `prefers-reduced-motion` 下关闭所有非必需动画。
- 初版无音乐、无强制音效；如果添加，以用户主动开启为前提。

## 6. 文案规范

**应使用**：`Agent suggested contributing 50 BUILD`、`Awaiting your confirmation`、`Confirmed at block 58...`、`Unable to verify Agent ID`。

**禁止使用**：`Your AI has transferred assets automatically`、`Guaranteed earnings`、`You are verified human`、`Wallet connected`（若只是输入了地址）、`On-chain vote completed`（若尚无 receipt）。

中文界面可用“已检测到 Agent ID”“等待本人确认”“等待链上最终确认”“AI 建议（链下）”“链上已确认”。

## 7. Accessibility / Error / Empty

- 所有图表提供数值文本；颜色不能是唯一状态信号。
- 按键可键盘操作、焦点清晰、弹窗开合与 ESC 行为符合可访问要求。
- 请求失败不整页空白；显示 `RETRY` 与上次可信数据更新时间。
- 0 个活跃 Agent 时显示真实空状态，而非生成 30 个假 Agent 头像。
- 初次使用提供 3 步手册：查 ID → 激活身份 → 创建 Agent；可随时跳过继续浏览。
- 移动端不裁剪完整风险提示、目标合约地址和交易差异。

## 8. 不同业务状态视觉验收

- [ ] 观察者与注册公民首页差异明确。
- [ ] 非 ID 查询、RPC 错误不混淆。
- [ ] 所有链上操作前能看到准确目标合约、方法、参数和网络。
- [ ] 非支持钱包明确显示 `UNSUPPORTED`，不假装一键签名。
- [ ] `PROPOSED` 与 `CONFIRMED` 在颜色、文字、证据上三个层面区分。
- [ ] 建设进度来自实时链上状态，交易未确认时不提前推进。
- [ ] 目标达成不可继续贡献，展示完成时间和事件。
- [ ] 桌面宽 1440px、平板 1024px、手机 390px 均正常显示。
- [ ] 无键盘陷阱，ARIA label 和对比度满足目标。
- [ ] 所有数字、时间、哈希、来源类型可定位到数据字段。

## 9. 可直接交给 UI 生成 AI 的简短任务指令

> Design a functional, premium terminal-OS interface for AGENT REPUBLIC, a BNB Chain Agent ID-native autonomous society. Use graphite-black surfaces, subtle signal-teal accents, sparse muted gold milestones, restrained typography, disciplined high-density grids, clear wallet transaction states, and differentiated off-chain agent suggestions vs confirmed on-chain facts. Show real application architecture: WORLD, MY AGENT, COUNCIL, PROJECTS, IDENTITY, ACTIVITY. Avoid generic AI SaaS gradients, oversized robot art, meaningless glow, fake financial data, and illegible neon. Produce cohesive responsive screens; do not fabricate transactions or user counts. The GOLDEN TOILET TOWER has goal 2000 BUILD; progress comes from data and defaults to zero before contributions.

该指令是**视觉方向**而不是替代产品 PRD 或链上代码规格。


## 10. v1.1 视觉升级：自治世界终端（覆盖此前偏平面的世界页表达）

### 10.1 五区布局

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ AGENT REPUBLIC  / BSC  / EPOCH  / SYNC HEIGHT / CAMERA  / IDENTITY          │
├─────────────┬───────────────────────────────────────┬───────────────────────┤
│ WORLD DATA  │ DISTRICT 01 / 3D CITY                 │ AGENT FEED            │
│ population  │ [四建筑 + 广场 + 角色标记]            │ approved discussion   │
│ publicworks │ [project stage from confirmed chain] │ proposals vs actions  │
│ governance  │ [zoom / rotate / reset / focus]       │ source badges         │
│             │                                       │ selected detail       │
├─────────────┴───────────────────────────────────────┴───────────────────────┤
│ ONCHAIN EVENTS / PENDING APPROVALS / LAST VERIFIED BLOCK / FALLBACK        │
└─────────────────────────────────────────────────────────────────────────────┘
```

`WORLD_ENGINE.md` 定义唯一 `WorldFrameV1`；`3D_RENDERING.md` 定义 camera、几何、模型与资产，UI 不重复设置世界坐标。高质量的视觉应通过原创资产、材质和动画达成，**不是把三张科幻概念图拼贴成网页**。

### 10.2 具体交互场景

- **点击议会大厅**：显示正式链上提案、剩余截止时间、各 Agent 的审核讨论。链上票数和 AI 偏好分组呈现。
- **点击身份中心**：展示 Agent ID 是否持有、注册状态以及身份交互指南；不得要求提供 pairing code。
- **点击公共建设区**：项目 #1 金色马桶大厦四阶段模型、已确认进度/贡献者；pending 的捐献留在交易队列。
- **点击 Agent 核心**：查看 Agent 运行队列、目标和公开活动；登录后才能查看自己私有配置。
- **点击 Agent 棋子**：名称、身份 owner、人格标签、已审核讨论记录、是否在模拟移动。不能直接从棋子执行任何链上交易。

### 10.3 状态标识与信任感

| 标签 | 含义 | 呈现原则 |
|---|---|---|
| `ON-CHAIN CONFIRMED` | 已确认合约事件 | 展示 tx 入口与确认区块 |
| `TRANSACTION PENDING` | 待验证/打包中 | 不改建设进度 |
| `AI SIMULATED` | 模型生成并审核的社会互动 | 明确不是链上确认 |
| `WORLD VISUALIZATION` | 角色位置/镜头/特效 | 没有收益效果 |
| `SYNC DELAYED` | 链索引落后或 RPC 失败 | 显示最后可信区块 |
| `REORG RECOVERY` | 重新对账 | 暂停庆祝动画和确认断言 |

### 10.4 品质与可访问性验收

- 桌面 1440/1280/1024 布局，移动 390/360 布局；手机隐藏次要边栏而不隐藏交易来源和错误状态。
- 浏览器不支持 WebGL2 时，四建筑以 HTML 列表与项目卡等价交互，用户仍能查看公民身份、投票和建设。
- 可键盘聚焦建筑列表、ESC 取消模型选中、触屏点击/缩放；`prefers-reduced-motion` 生效。
- 默认色彩继续保持 `#080B0D` + `#51B8A7` + `#C2A36C`，保持工业级克制，不使用紫蓝大渐变和廉价霓虹。
- 同一个真实贡献事件刷新后不可重复播放首次里程碑特效；本地 mock 场景必须始终显示 `DEMO`。

### 10.5 交给 UI 开发 AI 的设计约束

> Build a real, interactive orthographic 3D autonomous society console using R3F and original modular models, not a raster illustration. Central District 01 has four distinct landmarks and up to 30 AI markers; left rail shows chain-derived world data; right rail shows moderated social events, always labeled AI-simulated vs on-chain confirmed. The Golden Toilet Tower is staged solely by on-chain funding progress. Use a refined graphite/teal/muted brass visual system, informative density, understated motion, reliable fallback, accessible keyboard navigation, and no fabricated wallet success state.
