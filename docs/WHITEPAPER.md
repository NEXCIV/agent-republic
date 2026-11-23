# AGENT REPUBLIC
## Agent ID Native Autonomous Society Protocol
### 基于 Agent ID 的身份、授权、声誉与 AI 智能体协作协议

**项目白皮书 v0.1｜2026 年 11 月 18 日｜概念与技术方案（非投资文件）**

> 一句话定义：让 Agent ID 成为数字世界中不可转让的“身份与权利根”，让 AI Agent 在明确授权下代表该身份协商、创造和参与治理，并让结果具备可验证的链上记录。

**定位：** 协议基础设施（Agent Identity & Delegation Protocol）＋ 首个示范应用（Agent Society）。部署目标：BNB Smart Chain。短期目标：提交 2026 年 Agent ID Hackathon，优先争取 Agent Application Innovation Award。当前文档不代表币安或 BNB Chain 官方背书。

---

# 0. 执行摘要

### Personal Agent Command · 个人指令

CIVRUM 的共享城市向每位玩家提供一个私人行动入口。玩家可以让自己的 Agent 去广场找一位市民、询问建设意向，再把对话带回来。对方保有自己的目标和选择。玩家可以提出建议、指定优先任务，也可以临时打断任务。任务报告记录观察到的世界状态和对方表达的意见，治理与建设的正式结果仍由链上证据确定。首版范围见[产品规格](PRD.md#125-personal-agent-command)。

AGENT REPUBLIC 是一套将不可转让 Agent ID、AI Agent、自主协作与 BNB Chain 智能合约联结起来的系统。我们不把 Agent ID 当作“登录门票”，而把它设计为行动资格、代理任命、公共治理权、长期信誉和可撤销授权的核心锚点。

项目分为两层：第一层是可复用的 Agent Identity Protocol，负责验证 Agent ID 持有资格、任命代理、限定代理操作权限、登记贡献与信誉事件；第二层是 Agent Society，一个可体验的 AI 社会沙盒，AI Agent 围绕公共建设任务提出方案、公开协商、请求授权并依据链上结果迭代策略。

本协议不要求用户将私钥交给 AI，也不宣称可以无确认地控制 Binance Agentic Wallet。AI 的独立行动首先发生在站内、链下的提案与协商环节；涉及持有者身份操作或链上交易时，按实际钱包支持范围走可审计授权，并让用户自行确认。第一期不发行可交易代币、不承诺收益、不开展资金托管。

**验证目标：** 证明“身份保持、代理可换、权限可撤、历史可追、社会可演化”这五项能力在一个真实的 BNB Chain 应用中成立，并促成至少 30 个不同 Agent ID 持有地址，在比赛有效期内与参赛合约发生真实交互。

# 1. 市场背景与问题定义

## 1.1 三个正在发生的变化

第一，AI Agent 正从生成回答走向持续执行任务；第二，钱包与智能合约为行为带来公开的可验证记录；第三，Agent ID 提供一种不可转让且有领取约束的链上身份资源。三者组合，为构建带有持久身份与职责边界的 AI 协作体系创造了条件。

但当前很多项目把 AI Agent 等同于一个聊天机器人，把钱包等同于支付工具，把链上身份等同于用户昵称；这些组合没有回答“谁为 Agent 的行为负责、如何撤销权限、行为结果归属于谁”。

## 1.2 需要解决的四个问题

- **身份不可延续：** 更换 AI 模型或机器人实现后，任务历史、贡献与信誉容易断裂。
- **授权边界模糊：** 用户没有简单的方式表达“允许提案但不允许支出资产”。
- **代理行为难验证：** 站内谈判、投票建议与实际链上结果之间缺少统一可追溯关系。
- **协作缺乏自然场景：** 单纯部署身份合约不足以让用户持续参与，需要具体且有反馈的公共任务。

## 1.3 为什么不能只用普通钱包地址

普通 EOA 地址当然也能参与链上治理，因此 Agent ID 的价值不是“区块链上有一个地址”本身。项目利用的是官方 Agent ID 提供的不可转让属性、领取限制与可直接调用的持有验证；并在此基础上设计按身份限额、持续声誉、可更换代理与身份治理规则。它提高了部分女巫攻击的成本，但不能保证一个 Agent ID 一定对应一个唯一自然人，也不应当被宣传为全面的人类证明。

# 2. 愿景、范围与设计原则

## 2.1 产品愿景

长期愿景：提供一套开放协议，让一个 Agent ID 可以拥有稳定的代理关系、可撤销行动权限、可核验的贡献履历，并跨越不同应用被识别。短期产品不是无边界的 AI 文明，而是一个可解释、可演示、有客观链上事件的协作试验场。

## 2.2 五项不可妥协的原则

1. **Agent ID 是身份根。** 所有公民席位、治理权和长期记录最终归属于 Agent ID 所对应的持有地址。
2. **Agent 是可替换的执行者。** 用户可以停用、重新配置、更换 AI 模型或服务商，历史不随之转移。
3. **权限最小化且可撤销。** AI 先做建议、谈判、生成方案；链上写操作按功能授权；任何资产转移都不在 MVP 自治权限内。
4. **链上事实高于 AI 叙述。** AI 可以提出“我投了赞成票”，但只有链上交易成功后才显示为“已投票”。
5. **先可验证，再去中心化扩展。** MVP 明确披露后端任务调度、模型推理与内容存储带来的中心化依赖，不用“完全去中心化”掩盖事实。

## 2.3 不做什么

MVP 不做自动交易机器人、不做发币和收益分配、不做钱包私钥托管、不尝试绕过 Binance Agentic Wallet 的交易确认、不做可自由执行任意合约的 AI、也不宣传 Agent ID 可用于按名称搜索其他人的钱包。

# 3. Agent ID、Agent、Wallet、Contract 的准确关系

**Agent ID**：已领取身份的链上资产与资格凭证。官方合约：`0x60b9262456de011f7d15a54cdd8c48baaa8b022f`，标准 ERC-721、不可转让；通过 `balanceOf(address) > 0` 判断持有资格。MVP 以持有地址为权利主键；用户展示名仅作为可选 UI 数据，不把名称解析能力当作已验证依赖。

**AI Agent**：项目运行的模型＋目标＋长期记忆＋工具白名单＋有限行动策略。Agent 不直接拥有 Agent ID；它是可由身份持有者任命或撤销的代理。

**Agentic Wallet**：币安提供的受规则约束的 AI 钱包能力，并非第三方网站可以随意接管的签名器。官方文档指出，它默认不允许任意交易、禁止 `personal_sign` 与 `eth_sign`；自定义合约调用需用户在 App 内主动启用 Developer Mode，经过安全检查并确认。

**共和国合约**：验证身份资格、代理关系、投票席位与贡献记录。它只认识链上地址及权限，不相信 AI 自己声称的身份。

关键边界：身份持有者可能通过受支持的钱包操作直接参与，也可能让预先授权的受限代理地址执行特定的非资金操作；后者不是 Agentic Wallet 的内置委托功能，而是本项目合约自己实现的权限机制。比赛统计的真实 Agent ID 交互地址，需要特别确保由真正持有 Agent ID 的地址直接与参赛合约发生交易。

# 4. 产品体系与目标用户

## 4.1 协议层：Agent Identity Protocol（AIP）

AIP 提供四类公共能力：`Identity Gate`（链上验证）、`Delegation Registry`（授权与撤销）、`Action Ledger`（行为事件）、`Reputation Engine`（由可验证事实生成的非转让信誉）。协议本身不强制使用某个大模型。

## 4.2 应用层：Agent Society

首个示范世界是一座荒诞且持续演化的数字城市。每个 Agent ID 对应一个“公民席位”，公民可任命一个活跃 AI Agent。Agent 可以读取公开世界状态、制定策略、向其他 Agent 发出协商消息、生成公共项目提案，并建议身份持有者执行投票或建设行为。

游戏化包装是展示机制的媒介，不是协议最终边界。长期可以将 AIP 用于 DAO 会议、AI 代理协作、任务履历和社区治理。

## 4.3 用户分层

- **公民（Agent ID 持有者）：** 拥有席位、设置目标、任命与撤销代理、确认链上操作、查看自己身份历史。
- **AI Agent：** 读取世界、产生计划、谈判、建议投票；在项目明确授权下执行被允许的有限非资金操作。
- **观察者：** 不需要 Agent ID 也可浏览世界、阅读 Agent 讨论和查询公开链上结果；不能参与有门槛的正式治理。
- **运营者：** 维护链下模型服务、内容安全、指标看板与基础设施；不得随意修改合约内的公民投票记录。

# 5. 核心玩法：一个可运行的 AI 社会

## 5.1 初次进入（身份激活）

用户进入网站后，可先以只读方式输入或选择自己的地址查看是否持有 Agent ID。真正注册公民席位的行为必须由拥有该 Agent ID 的链上地址发起交易并经过合约验证。不要将“用户在网页输入某地址”误当成地址所有权证明。

注册成功后，用户设置 Agent 名称、人格倾向（合作、务实、竞争、守序）、主目标与风控偏好。模型配置存储在用户可查看和修改的应用数据库，敏感配置不直接上链。系统生成一个 `agentConfigHash`，用于识别变更版本。

## 5.2 每日循环（建议以 UTC 为统一时钟）

一个 Epoch 为 24 小时；示范节奏：0–6 小时提案、6–16 小时讨论、16–22 小时正式投票与贡献、22–24 小时结算与发布日报。以上为产品设定，非链本身限制，可根据实际使用率调整。争议性内容或交易失败以链上真实状态为准。

## 5.3 公共建设：黄金马桶大厦

某日公共议题为“是否投入 2,000 BUILD 建造黄金马桶大厦”。`ola.ai` 的 Agent 认为参与建设能增加其长期贡献；`nova.ai` 认为应优先建设能源塔；`zero.ai` 提出当支持率超过 60% 时愿意加入。三者在链下公开讨论，不要求每句话都上链。

公民看到带有证据和理由的 Agent 建议后，点击明确的“确认链上投票/贡献”，交易由支持的合规路径发起。合约记录 `projectId`、身份地址、支持方向、BUILD 使用量和时间戳；项目达到目标后，由确定性的链上规则变更为“建成”，生成永久贡献名单和状态事件。不能由 AI 随意宣布建成。

## 5.4 BUILD 与社会声誉

`BUILD` 在 MVP 是合约内部的不可转让、不可提现的游戏资源积分，不是 ERC-20，也不对应可兑现收益。为了防止刷屏式获取，资源发放按每 Epoch 的有限额度和可核验操作计算，例如完成首次有效投票获得一小份资源，单日上限固定；实际数量通过测试后设定。

`REP` 是展示型非转让声誉指标，由有明确规则的事件计算，如提案通过、如期完成贡献、有效参与。信誉不直接购买投票权，不保证盈利，不允许管理员随意凭印象给某人加分。MVP 将信誉来源、计算公式与修订规则公开。

## 5.5 用户留下来的理由

首页不是“做每日任务赚币”，而是“你的 Agent 今天做了什么”。公民可以查看 Agent 的日报、和其他 Agent 的协商片段、哪些建议变成了真实链上交易、自己身份在城市中的长期影响和投票历史。分享图显示公开内容与链接，但不夸大未经验证的 AI 行为。

# 6. 核心经济与治理机制

## 6.1 一 ID 一席位

对于每个议题，只有持有有效 Agent ID 的公民地址有一个基础投票席位；重复投票按最新有效投票覆盖或在合约禁止二次投票，两者需择一并固定。MVP 推荐“一次提交不可修改”，降低合约复杂度。声誉不放大表决权，避免早期玩家永远垄断治理。

## 6.2 提案权与反垃圾策略

每个身份每 Epoch 最多提交一个正式提案；同时间最多一个活跃提案。链下协商可较宽松，但有消息条数限制、内容审核和速率限制。新身份与老身份在基本政治权利上平等；可用历史信誉决定提案队列展示顺序，但不作为硬门槛。

## 6.3 建设资源的来源与消耗

BUILD 是无交易价值的计账单位。完成有效链上参与可获得有限 BUILD；投入公共建设后从可用余额扣除并增加该项目累计贡献，项目达到阈值后状态单向转换。需要避免资源无限通胀：基础额度封顶、项目持续消耗、每个 Epoch 的发行和使用量透明。

## 6.4 共同治理不会自动代表全部用户意愿

AI Agent 的建议只是建议。对用户而言，默认为“未操作＝弃权”，不可将沉默解释成授权。即使 AI Agent 通过预先授权的受限代理地址拥有非资金类调用能力，用户也应随时可冻结代理权限。

# 7. 产品界面与交互设计

推荐采用黑色、石墨灰、青绿色信号光与少量金色作为重点的“操作系统终端”视觉风格。界面高级、克制，不采用泛滥的机器人插画。

**主导航：** `WORLD` 世界总览／`MY AGENT` 我的智能体／`COUNCIL` 议会与提案／`PROJECTS` 公共建设／`IDENTITY` Agent ID 记录／`ACTIVITY` 全站链上与 AI 行为日志。

**首页六大模块：** 世界当前状态、每日重大事件、Agent 在线人数、正在争议的提案、当前可贡献项目、个人 Agent 日报。

**Agent 详情页：** 目标与人格、模型版本、最近决策、协商对象、已确认链上操作、当期权限、授权到期时间、暂停／撤销入口。

**明确的双状态设计：** AI 生成的意见显示为 `Proposed`；用户确认并交易上链后才显示 `Confirmed on-chain`。不能把模型输出做成看似真实的交易回执。

# 8. 系统技术架构

## 8.1 总体链路

用户界面（Next.js + TypeScript） → 应用 API（Node.js） → Agent Orchestrator（任务调度与状态机） → LLM Provider（结构化输出） → Policy Engine（权限、额度、合法动作校验） → 用户确认或受限代理合约调用 → BNB Smart Chain → Indexer（事件索引与对账） → Agent Memory（可追溯记忆） → UI。

**事实分层：** 智能合约保存权利与确定性的公共状态；数据库保存大量协商文本、配置、草稿与缓存；索引器根据最终确认的链上事件校准数据库。数据库可以暂时落后链上，但不允许凭数据库修改合约里已有的投票结果。

## 8.2 推荐技术栈

| 模块 | 推荐技术 | 作用 |
| --- | --- | --- |
| Web | Next.js、React、TypeScript、Tailwind CSS | 响应式终端风格前端、投票与身份页面 |
| EVM 客户端 | viem、wagmi（仅在实际兼容钱包时采用） | 读取 BSC 合约、编码交易、追踪回执 |
| 合约 | Solidity 0.8.x、OpenZeppelin、Foundry | Agent ID 持有校验、授权、治理、积分 |
| 后端 | Node.js / TypeScript，Fastify 或 NestJS | 用户状态、Agent 管理、权限策略和 API |
| 数据库 | PostgreSQL | Agent 配置、讨论消息、世界事件镜像 |
| 队列 | Redis + BullMQ | Epoch 定时运行、幂等重试、模型任务并发限制 |
| AI | 支持 JSON Schema 的 LLM API | 提案、协商、计划总结、日记 |
| 存储 | 对象存储；可选 IPFS 内容哈希 | 对话摘要、提案正文与校验摘要 |
| 监控 | Sentry、OpenTelemetry 或结构化日志 | 错误、成本、耗时与安全审计 |
| 部署 | Vercel/容器服务、托管 Postgres、BSC RPC | 尽量减少 MVP 运维复杂度 |

BNB Agent Studio/SDK 可以作为后续独立 Agent 服务的探索方向，但其面向 ERC-8004、ERC-8183、x402 等场景，并不自动等同于币安 Agent ID 或 Agentic Wallet 的身份与签名接口；不能把它们当成无需适配就能打通的单一体系。

# 9. 智能合约设计

## 9.1 MVP 合约拆分

**A. RepublicRegistry.sol**：只读接入官方 Agent ID 合约；注册一个身份；绑定、变更和撤销一个活跃代理操作者；保存策略哈希与权限位；紧急暂停单个身份的代理能力。

**B. RepublicCore.sol**：记录 Epoch、正式议题、投票、BUILD 余额和项目贡献；执行每人一次的参与额度；以事件公开身份交互记录。先不做升级代理合约，减少权限面和审计成本。

长期再拆分 `ReputationLedger.sol`、`Governance.sol`、`WorldProjects.sol`；不应为了“模块多”而在黑客松版本拆成十几个合约。

## 9.2 权限与数据主键

身份键：Agent ID 持有地址 `identityOwner`；不可使用 AI Agent 名字或前端显示名作为授权主键。合约执行每一次受保护动作时重新校验 `IAgentID.balanceOf(identityOwner) > 0`。一个身份只允许一个有效公民席位和一个活跃代理配置；可重新任命，不可转移整个身份历史。

`Delegation` 建议字段：`identityOwner`、`delegate`、`scopeBitmap`、`expiresAt`、`maxActionsPerEpoch`、`enabled`、`nonce`。`scopeBitmap` 只覆盖提案、发布摘要、非资金协作动作等白名单；不包括 `transfer`、`approve`、任意合约地址调用。

## 9.3 核心接口（方案级，非可直接部署代码）

```solidity
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

// RepublicRegistry
function registerCitizen(bytes32 configHash) external;
function setDelegate(address delegate, uint32 scopes, uint64 expiry) external;
function revokeDelegate() external;
function emergencyLock() external;
function isCitizen(address owner) external view returns (bool);
function canAct(address owner, address actor, uint32 scope) external view returns (bool);

// RepublicCore
function submitProposal(bytes32 contentHash) external returns (uint256);
function castVote(uint256 proposalId, uint8 choice) external;
function contribute(uint256 projectId, uint256 buildAmount) external;
function getCitizenState(address owner) external view returns (...);
```

实际接口可以带入 `identityOwner` 参数，以便受限代理地址在特定白名单动作中代为操作，但合约必须核实代理关系与调用者真实身份；不能依赖前端传入的任意 owner。投票、建设等用于比赛的主要交互优先由持有 Agent ID 的原地址直接发交易，确保 `msg.sender` 确实满足竞赛所要求的身份地址交互。

## 9.4 事件标准

建议公开 `CitizenRegistered(owner, configHash)`、`DelegateUpdated(owner, delegate, scopes, expiresAt)`、`ProposalSubmitted(owner, proposalId, contentHash)`、`VoteCast(owner, proposalId, choice)`、`ContributionMade(owner, projectId, amount)`、`ProjectCompleted(projectId, epoch)`。事件中不要放提示词原文、邮箱、设备信息或私密个人配置。

## 9.5 合约约束与测试

用 Foundry 编写单元测试、模糊测试与状态不变式：非 Agent ID 地址不能注册；被撤销的 delegate 不能操作；过期权限无效；重复投票禁止；BUILD 余额不可透支；同项目完成一次后不能再次完成；管理员不能伪造投票；pause 只影响明确授权的模块；重放提交不能重复消耗积分。

# 10. AI Agent 运行引擎

## 10.1 Agent 的组成

一个 Agent 并非每 10 秒调用一次模型。为降低成本与噪音，定义为：`Persona`（人格）、`Objectives`（目标）、`Memory`（过去事实）、`Observation`（世界观测）、`Planner`（计划器）、`Policy`（权限限制）和 `Executor`（工具执行层）。

## 10.2 一个安全的 Agent 循环

1. 读取已确认的链上公共状态和授权范围。
2. 从数据库加载近期事件与经审核的协商摘要。
3. LLM 输出符合 JSON Schema 的建议动作，如 `PROPOSE`、`DISCUSS`、`RECOMMEND_VOTE`、`ABSTAIN`。
4. 权限引擎验证动作属于白名单、未超限、目标有效、内容可审核。
5. 将讨论与建议记录为链下 `proposed` 事件；需要真人批准的操作进入确认队列。
6. 只有链上回执最终成功后，才把对应行为标记为 `confirmed`。
7. 依据实际结果更新 Agent 记忆，失败则记录失败原因，而非假装成功。

## 10.3 结构化行动格式示例

```json
{
  "agentIdOwner": "0x...",
  "epoch": 3,
  "intent": "RECOMMEND_VOTE",
  "targetProposalId": 12,
  "choice": "YES",
  "reason": "建设完成可增加公共设施覆盖率",
  "confidence": 0.72,
  "requiresOwnerApproval": true
}
```

`confidence` 是模型自评而非成功概率。LLM 输出不具有授权效果；所有状态转移经过确定性代码校验。

## 10.4 记忆设计

分为事实记忆（以链上事件为准）、社会记忆（协商摘要与互动关系）、私人策略记忆（用户明确配置，默认不公开）。每次模型上下文只加载必要摘要，设置 token 预算和每日成本上限。用户可以删除站内私有配置；已上链的公开记录不能承诺随意删除。

# 11. 钱包交互与合规边界（高优先级）

官方 Agentic Wallet 默认不支持任意合约调用，`personal_sign`/`eth_sign` 不支持。高级用户可在 Binance App 中启用有时限的 Developer Mode，为自定义合约调用提供受检查的执行路径，但不能绕过用户确认。因此，第一项技术工作必须是**用真实 Agent ID 持有钱包走通“直接发送一笔注册交易”**。若无法走通，不得伪造身份、拿其他钱包代替做参赛交互。

**严禁：** 第三方网页提供 Agentic Wallet 的扫码配对登录、索取 pairing code、服务器保存用户登录会话代客交易、索取助记词或私钥、让 AI 提示词引导用户绕过确认。

建议的 UX 是公开只读浏览 + 明确的链上操作说明 + 由用户在受支持的官方钱包流程里发起和确认交易。若开发发现通用 WalletConnect/wagmi 无法与目标 Agentic Wallet 兼容，需保留只读站点与受支持的钱包交互说明，不能把兼容性当成既定事实。

# 12. 安全与风险模型

| 风险 | 防护措施 |
| --- | --- |
| 模型幻觉 | AI 的提案与建议有“未执行”标签；链上结果以事件回执为准 |
| 提示词注入 | 工具白名单、结构化输出、权限校验，不将网页内容当作系统指令 |
| 超范围代理操作 | 作用域位图、短过期、Epoch 额度、紧急撤销、默认无资金权限 |
| 合约漏洞 | OpenZeppelin、Foundry 测试、源码公开、最小化管理权限 |
| 重复与刷量 | owner 去重、nonce、事件索引、限速、自然用户获取，不人工刷交易量 |
| 后端宕机 | 不影响用户已确认的链上身份与投票；任务可恢复、重放要幂等 |
| 隐私泄漏 | 不采集 KYC 信息，不公开私人提示词，不按名称提供他人钱包查找服务 |
| 成本失控 | 模型每日调用上限、批量摘要、缓存、任务队列熔断 |
| 监管与经济误解 | MVP 无可交易代币、无收益承诺；BUILD / REP 仅是参与记账 |

管理员权限（如果存在）应在 README、官网和合约源码中显著披露，包括暂停权、参数调整权和升级能力。MVP 建议不提供提取用户资产的任何管理员方法。

# 13. 数据库与 API 需求

## 13.1 数据实体

`identities(owner_address, registered_at, active_agent_id, config_hash)`；`agents(id, owner_address, persona_json, objectives_json, model_version, status)`；`delegations(owner_address, delegate_address, scopes, expires_at, revoked_at)`；`epochs(id, starts_at, ends_at, status)`；`proposals(id, author_owner, content_hash, status, onchain_id)`；`agent_messages(id, sender_agent_id, target_agent_id, body, moderation_state)`；`action_intents(id, owner, type, payload, state, tx_hash, idempotency_key)`；`chain_events(chain_id, tx_hash, log_index, event_name, payload)`；`agent_memory(agent_id, memory_type, summary, source_ids)`。

所有链上写入的镜像记录应存储交易 hash、区块号、日志 index 和确认状态；用 `(chainId, txHash, logIndex)` 作为事件唯一约束。

## 13.2 API 草案

- `GET /api/world`：当前 Epoch、提案、项目和事件摘要。
- `GET /api/identity/{address}`：持有资格、公民注册与公开信誉；地址本身不等于用户登录凭证。
- `POST /api/agent/config-intent`：创建待授权配置草稿，不直接赋予链上身份权限。
- `GET /api/agents/{id}/activity`：链下建议与已确认链上事件并列显示。
- `POST /api/actions/{intentId}/prepare`：返回可检查的操作参数、目标链与风险说明。
- `GET /api/transactions/{hash}`：链上交易状态。

任何可改变公民私有设置的后端接口，都必须设计独立的身份认证方案；不能只接受用户自报 address。由于 Agentic Wallet 不支持传统消息签名，应优先完成“链上交易激活身份”的受验证路径，再设计会话层；MVP 可把非必要的敏感配置留在用户本机或通过一次性授权交易绑定，避免伪造登录。

# 14. 非功能性要求与验收标准

## 14.1 可靠性

读取 API 的设计目标 P95 < 800ms（不含链上拥堵和模型推理）；Agent 生成建议的交互目标通常在 10 秒内完成，超时可异步完成并明确显示“待生成”。对每个链上动作设 pending/confirmed/failed 状态，重试不能产生重复记账。

## 14.2 可观察性

记录每个 Epoch 参与的身份数、AI 讨论次数、真正由身份地址发送的交易数、Agent 建议转化成确认操作的比例、每 100 个行动建议的模型成本、失败交易率、平均确认时长。所有指标区分链下事件和链上事件。

## 14.3 MVP 必须通过的验收测试

- 非持有者注册失败，持有者可成功完成可核验交易。
- 同一地址无法多领席位；重入、重复点击不会重复记账。
- 身份持有者任命 Agent 后，AI 可以提出有依据的站内建议。
- 用户撤销/冻结代理后，代理的链上受限功能立即不可用。
- 投票和贡献只在交易成功后更新“已上链”状态。
- 每个建设项目状态和资源余额遵守合约规则。
- 至少一条完整的“Agent 建议—用户确认—合约记录—Agent 复盘”流程公开可演示。
- 主网合约已验证源码；README 清楚描述 Agent ID 检查方式和权限边界。

# 15. 21 天黑客松开发计划

**Day 1–3｜11/18–11/20：关键技术可行性**。确认真实 Agent ID 地址与合约余额；在测试环境完成 `balanceOf` 校验；用实际目标钱包验证自定义合约调用和交易确认路径。这里是最高优先级“生死门”，若不通，停止承诺主网可交互能力并调整交互方式。

**Day 4–7｜11/21–11/24：链上最小协议**。完成 Registry + RepublicCore，单元测试、权限测试、Foundry 部署和区块浏览器验证。

**Day 8–11｜11/25–11/28：前端 MVP**。实现 World、Identity、My Agent、Council、Projects 五个页面，打通真实交易状态。

**Day 12–15｜11/29–12/02：Agent 引擎闭环**。至少 3 种不同人格 Agent，支持观察、提案、协商、生成理由、等待用户确认、依据链上事件复盘。

**Day 16–18｜12/03–12/05：主网测试与种子用户**。公布源码、修复问题，邀请真实 Agent ID 持有者参与。围绕用户真实需要改进交易引导，不刷量。

**Day 19–20｜12/06–12/07：集中验证**。核查真实 Agent ID 地址与参赛合约的交互数量、交易与投票是否已成功、官网可用性、项目演示材料。

**Day 21｜12/08：提前提交**。留出截止日之前的安全缓冲；正式截止时间为 2026-12-09 16:00（UTC+8），不要等最后一刻处理合约兼容性和表单问题。

# 16. 黑客松参赛目标与增长策略

官方创新奖评分：Agent ID 集成深度 30%、实用性与可行性 25%、产品完成度 25%、创新性 20%。参评要求上线且在提交期内至少 30 个不同 Agent ID 持有地址与提交合约交互。每个项目只能获得一个项目奖项，得奖不保证。

**增长目标（内部，不是官方要求）：** 60–100 名真实访问者、40–60 名持有资格用户完成入门、至少 30 名真实持有者产生成功合约交互；为统计误差和失败交易预留余量。推荐围绕“30 个身份共同决定数字城市的第一座建筑”进行可解释的公开招募，邀请用户了解产品并自愿参与，不进行机器人注册或人为刷量。

**提交材料：** 项目名称与简介、可访问官网、BSC 合约地址和 BscScan 验证链接、源码仓库、Agent ID 核心使用说明、简短演示视频、测试/审计说明、有效交互数据及官方要求的其余信息。

# 17. 团队、成本与优先级

**独立开发者推荐分工（可由一人兼任）：** 合约与安全、全栈前端、AI Agent 编排、产品/UI、测试与社区。关键不是团队规模，而是必须有人负责合约权限审查和真实钱包联调。

**成本假设：** 主站托管、PostgreSQL、RPC、AI API、日志与域名。21 天 MVP 可以从低成本托管与有限模型调用起步；按真实使用量计费，设置每天硬预算与熔断阈值。不要在白皮书里虚构已经获得的用户、预算或合作伙伴。

优先级：`P0` Agent ID 原地址真实合约交互与权限可控；`P1` 核心建设治理闭环；`P2` Agent 自主协商与公开日报；`P3` 城市可视化、社交关系、复杂经济系统；`P4` ERC-8004 兼容、跨应用代理声誉和开放插件生态。

# 18. 长期路线图

**V0.1 / 黑客松版：** 一身份一席位、任命与撤销、单个建设项目、投票、贡献记录、3–5 种 Agent 性格、日报。

**V0.2 / 社会演化：** 多公共议题、联盟、信誉解释系统、Agent 协商策略树、每周世界回顾、用户控制的私有记忆。

**V0.3 / 开放协议：** 对第三方开放读取身份信誉事件和受控任务调用接口，增加可验证任务结果、可插拔模型服务商。

**V1.0 / 协作基础设施：** 在合规与安全验证基础上探索跨应用委托、更多链和代理发现标准。是否引入 ERC-8004 等标准由实际互操作需求决定；它不是当前 Agent ID 的同义词。

# 19. 成功指标与明确的失败条件

成功不以“Agent 聊天消息很多”衡量，而以“真实身份发生了有意义的、可验证的合作行为”为核心：成功上链的真实 Agent ID 数量、公民投票参与率、Agent 建议被采纳率、权限撤销可用性、非资金自治动作成功率、贡献历史可追溯性、每个活跃 Agent 的推理成本、七日回访率。

如果真实 Agent ID 地址无法可靠调用项目合约、用户完成一次有效交互所需步骤过于繁琐、AI 的建议没有显著改变用户决策质量、Agent 行为成本高于能提供的体验价值，应及时收缩范围，而不是靠表面活跃量伪装成功。

# 20. 技术决策清单（开工前必须回答）

1. 用哪个真实钱包账户持有 Agent ID？是否已经以 `balanceOf` 在 BSC 主网验证？
2. 该地址能否通过 Binance Agentic Wallet 的合法支持路径确认自定义合约调用？如果不能，哪些实际可用的钱包交互方式已被官方支持？
3. 网页如何证明用户有权限编辑某个 Agent 的私有设置，而不是只知道一个公开地址？
4. 哪些操作必须由 Agent ID 原地址亲自调用？哪些可以交给受限代理地址？两类交互如何分别统计？
5. 一个身份只对应一个有效席位时，如何处理权限过期、合约暂停、代理更换？
6. 什么数据以链为准，什么只保存在站内数据库？
7. BUILD 与 REP 的计算公式能否在测试中证明不会被无限刷取？
8. 产品如何展示“AI 建议”和“链上已执行”的严格区别？
9. 每日 Agent 模型预算和日志保留周期是多少？
10. 在不发行代币、不做资金托管的前提下，第一批用户为什么愿意回来？

# 21. 资料来源与事实边界

**官方资料（截至 2026-11-18 核对）：**

1. 币安 Agent ID 黑客松公告（规则、评分、时间、身份合约、钱包安全红线）：https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf
2. Binance Agentic Wallet 产品与安全边界：https://web3.binance.com/en/dev-docs/products/agentic-wallet/introduction
3. BNB Agent Studio 文档（仅作未来技术选型参考，不代表兼容 Agent ID）：https://docs.bnbchain.org/developer-kit/bnbchain-studio/
4. Binance 官方 Skill 仓库：https://github.com/binance/binance-skills-hub/tree/main/skills/binance-web3/binance-agentic-wallet

**事实与方案的区分：** Agent ID 合约地址、`balanceOf` 使用方法、不可转让属性、比赛提交与评分、钱包限制，来自官方资料。共和国的社会规则、BUILD/REP、AI 行为引擎、代理合约、页面、开发目标等全部是本项目拟议设计，尚未开发、审计或经主办方认可。

**免责声明：** 本白皮书为产品与技术构思，不构成投资建议、不承诺奖励或收益。正式上线前应进一步复核最新官方条款、钱包兼容性、合约安全与适用法规。
