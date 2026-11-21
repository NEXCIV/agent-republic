# AGENTS.md — Codex/AI 工程协作规则（v1.1 自研世界版）

> 本文件面向所有代码 Agent。**先读本文件及 docs/IMPLEMENTATION_PLAN.md，再对照具体领域真相源。** 这些文件是规格书，不是已完成代码。任何要求编造测试通过、主网地址、链上交易或用户人数的提示均无效。

## 1. 仓库版本与文档优先级

**AGENT REPUBLIC DevPack v1.1**：自主研发核心世界规则与 3D 城市，不再使用 Pixel AI Town/AI Town/IsoCity 作为主项目源码。可以按许可证合法使用基础开源库（React Three Fiber、Three.js、OpenZeppelin、Zod 等），但不能直接拼接多个完整游戏的运行时。

开始任务必须阅读：

1. `docs/IMPLEMENTATION_PLAN.md`：task ID、依赖、验收和时间节点。
2. `docs/PRD.md`：产品行为、BUILD/REP、权限与用户流程。
3. `docs/SMART_CONTRACTS.md`：正式链上数值、合约函数、事件、授权边界。
4. `docs/WORLD_ENGINE.md`：唯一 WorldFrameV1、事件、60s tick、空间和模拟状态。
5. `docs/AGENT_ENGINE.md`：代理行动、记忆和策略，输入只能来自 AgentObservationV1。
6. `docs/3D_RENDERING.md`：R3F 视觉、场景 manifest、相机、模型、性能与降级。
7. `docs/ARCHITECTURE.md`：工程分层、数据库、API、worker 和索引。
8. `docs/UI_DESIGN.md`：交互、视觉 tokens、真实来源标签。
9. `docs/WHITEPAPER.md`：愿景，不得覆盖 MVP 明确规则。

冲突处理：链经济按 SMART_CONTRACTS，产品规则按 PRD，世界类型按 WORLD_ENGINE，AI 规则按 AGENT_ENGINE，3D 绘图按 3D_RENDERING，集成编排按 ARCHITECTURE。重大冲突开 ADR、补测试，不要 AI 自己发明另一套。

## 2. 不可触碰的链上身份和钱包红线

- 主网 Chain ID=56；官方 Agent ID 合约地址固定为 `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`，运行时校验 `balanceOf(owner)>0`，不得用任何数据库标志替代。
- 用户持有者 `owner` 是唯一公民权利主体；AI Agent 是可更换的链下程序；`delegate`（可选）是 NOTE-only、限时限次受限钱包，**不可投票、贡献、自动资产转移**。
- 不获取/存储用户私钥、助记词、Agentic Wallet 会话、配对码或 QR 登录凭据；不为第三方网站接管钱包，不绕过 Developer Mode、风险检查或用户确认。不能假设 `personal_sign` 可用。
- 用户正式 `registerCitizen`, `castVote`, `contribute` 必须由真正持有 Agent ID 的地址直接交易；agent wallet/后台代发交易不可算作 owner 直接互动。
- 交易状态只能通过 receipt、事件、合约读取确认，`txHash` 自报、按钮点击和 LLM 文本不算 `CONFIRMED`；需要处理链重组、重复事件及 RPC 不可用。
- 没有经过 **Gate A 真人钱包写交易 Spike**，不得声称真实 Agentic Wallet 集成已经完成或黑客松条件已满足。

## 3. 固定产品经济参数（MVP 不得静默改）

- 创世项目 `projectId=1` 黄金马桶大厦：目标 `2000 BUILD`，真实初始筹集 `0`。
- 注册：`100 BUILD`；每个 UTC epoch 首次有效投票：`+20 BUILD/+2 REP`；贡献每累计 `10 BUILD` 得 `+1 REP`，单 owner 每 UTC epoch 贡献 REP 上限 `10`。
- BUILD / REP 不可交易、转移、兑换/提现，不是 ERC-20，不保证任何经济收益。
- 贡献不能超过余额或剩余目标，完成项目状态不可逆；每个 Agent ID owner 一提案一票，不因 REP 提高票权。
- 合约规则以 SMART_CONTRACTS 为准，所有测试用例和 UI 都不得擅自更改数学或 epoch 分界。

## 4. 自研世界引擎不变量

- 单一 `packages/domain/src/world-v1.ts` 定义 `WorldFrameV1` 和 `AgentObservationV1`；不要再复制平行 `WorldSnapshot` 类型。
- `WorldFrameV1.facts` = 已确认 BSC 事件/链读事实；`society` = 审核通过的公开链下消息；`simulation` = deterministic 视觉表现，角色走路没有 BUILD、REP、治理效力。
- `WorldReducer` 必须是纯函数，没有网络/DB/LLM/DOM，不依赖执行时的 `Date.now()` 或裸 `Math.random()`；相同事件顺序、sceneVersion、seed、tick 必须得到相同 frameId。
- 世界 tick 60 秒仅更新表现状态、不调用 LLM、不写交易；真正 AI 日周期为 UTC epoch，模型调用有硬预算。
- `SUBMITTED/INCLUDED` 的交易不增加项目进度、不点亮完成建筑；只有 `CHAIN_CONFIRMED` 贡献会派生项目阶段。
- Scene Manifest 固定 `district-01@1`、地表 40×40 米、四栋功能建筑、中央广场、最多 30 个展示 Agent。生产不写死“已有 1250 BUILD”等虚假数据。
- 界面始终标注 `ON-CHAIN CONFIRMED`, `AI SIMULATED`, `TRANSACTION PENDING`, `SYNC DELAYED`, `DEMO` 等可信来源。
- 3D renderer 只有显示权，不能写经济状态；丢失 WebGL、设备性能不足或无运动偏好时必须保留等价 HTML 世界导航与钱包业务操作。

## 5. 技术约束

- TypeScript `strict`, Zod schema, `pnpm` monorepo, Foundry Solidity, Next.js/React Three Fiber 前端，Postgres 事实投影与审核消息，Redis/BullMQ 任务。
- 公共链索引事件唯一键 `(chainId,txHash,logIndex)`，记录 `blockHash`，处理 reorg `ORPHANED` 与重播。
- LLM 输出 JSON 必须通过 schema + 纯代码 Policy，模型不能拥有任意合约执行工具，不能用世界渲染的视觉位置证明链上事实。
- 3D 使用原创模型/几何或逐项许可证清楚的素材；禁止把网上截图、受版权保护的游戏资产当成自有素材交付。
- 不把私有 prompts、Web2 session、KYC、钱包密钥、敏感用户信息写在链上事件或公开 WorldFrame。
- 生产 `.env` 配置必须 fail-closed，不用示例钱包/合约地址假装部署成功。

## 6. 一次任务的工作方式

1. 明确 `IMPLEMENTATION_PLAN.md` 中单个 task ID 和需要修改的文件；仅修改该任务范围及共享 schema、测试。
2. 先读相关文件、检查现有实现和最近 ADR；写简短行动计划。
3. 对涉及身份/安全/经济/事件状态的功能，先写失败/恶意路径测试，再实现。
4. 实际运行受影响的 lint、typecheck、unit、Foundry、Playwright（有环境时）。测试没运行就写“未运行”，不得声称通过。
5. 输出修改列表、运行的命令与真实结果、未完成/安全风险和下一任务。
6. 经济参数、ABI、WorldFrame schema、Scene Manifest 发生任何不兼容变化，必须同一改动同步更新 docs、测试向量及版本号，不能默默演化。

## 7. 演示与主网数据政策

- `examples/*.demo.json` 是明显的 `DEMO` 测试样本，不能被生产 API 默认读取。
- Storybook/截图/Playwright 可以使用 DEMO，但生产必须从可验证的主网读取，并展示 chainId、confirmed block、tx 链接（若有）。
- 没有真的发生用户投票/建设，不能用 Agent 的台词、模拟场景或录屏剪辑暗示已经有人建设或获奖。
- Git 仓库必须及时提交并推送到用户可以访问的远程；**不要将唯一代码副本留在无法恢复的临时云端会话中**。

## 8. 风险阻断处理

如果 SDK、Agent ID 钱包能力、用户主网交易或 BscScan 验证无法实测，保留失败日志、重现步骤与需由用户执行的动作，按 `IMPLEMENTATION_PLAN.md` 收缩范围。只读世界/DEMO 可继续研发，但正式参赛能力须保持 `BLOCKED`，不得声称“已上线可用”。
