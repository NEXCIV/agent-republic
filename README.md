# AGENT REPUBLIC

**Agent ID Native Autonomous Society Protocol** · BNB Smart Chain · 自研世界与 3D 城市

作者 · **NEXCIV**

本仓库包含应用源代码、智能合约、Blender 源文件、3D 网页模型和 v1.1 开发规格。真实钱包适配和主网交易以端到端验证记录为准。

## 1. v1.1 新增什么

与 v1.0 不同：

- 自研数字社会核心，不复用 Pixel AI Town 的整体工程。
- 新增 `docs/WORLD_ENGINE.md`：单一世界状态协议、deterministic tick、链事件 + 链下社会、世界 API、回放/重组。
- 新增 `docs/3D_RENDERING.md`：React Three Fiber 正交城市场景、四建筑、建筑建设四阶段、30 Agent 标记、原创资产与降级。
- 更新 PRD、ARCHITECTURE、AGENT_ENGINE、UI_DESIGN、SMART_CONTRACTS 和 IMPLEMENTATION_PLAN，统一数据结构、权限及任务 ID。
- 更新根目录 `AGENTS.md` 的 Code Agent 纪律、身份安全与真实性要求。
- 新增 `examples/` 测试数据和 `CHANGELOG.md`，所有示例明确标记 DEMO。

## 2. 完整文件结构

```text
agent-republic-devpack/
├── AGENTS.md                      # Code Agent 主规则
├── README.md
├── CHANGELOG.md
├── .env.example                  # 只作配置模板，无私钥
├── docs/
│   ├── WHITEPAPER.md             # 项目愿景 v0.1（保留）
│   ├── PRD.md                    # v1.1 产品流程与玩法
│   ├── ARCHITECTURE.md           # v1.1 应用/世界服务
│   ├── SMART_CONTRACTS.md        # v1.1 ABI、身份、经济
│   ├── AGENT_ENGINE.md           # v1.1 AI 动作与记忆
│   ├── WORLD_ENGINE.md           # [NEW] 世界真相源
│   ├── 3D_RENDERING.md           # [NEW] R3F 场景规范
│   ├── UI_DESIGN.md              # v1.1 控制台设计系统
│   └── IMPLEMENTATION_PLAN.md   # v1.1 E0~E7 实施与验收
└── examples/
    ├── world-frame.demo.json    # 确保生产不会加载
    └── scene-manifest.demo.json # 场景合同示例
└── scripts/
    └── validate_devpack.py      # 规格包静态自检
```

## 3. Codex 正确打开方式

1. 在自己的 Git 仓库根目录解压 `agent-republic-devpack/` 下所有文件，将 `AGENTS.md` 保持在根目录。
2. 先提交到可控制的远程仓库并推送。不要只在 Codex 临时云端会话保存未经提交的源代码。
3. 让 Codex 完整阅读 `AGENTS.md`、`docs/IMPLEMENTATION_PLAN.md` 及当前任务对应的领域规范。
4. **第一步做 E0-01、E0-02；正式上链前必须完成 E1-00 Wallet Spike。**
5. 之后遵循：E1 合约 → E2 索引与 API → E5 World Engine → E6 3D / E3 AI Agent → E7 集成 → E4 上线提交。
6. 每次一个任务、运行测试、提交 Git commit；实际钱包操作和部署由用户审核并手动授权。

## 4. 给 Codex 的第一条命令

```text
你是 AGENT REPUBLIC 的工程实现助手。这个项目使用 v1.1 自研世界方案，不基于 Pixel AI Town 的整套源码。
请先通读 AGENTS.md、docs/IMPLEMENTATION_PLAN.md、docs/WORLD_ENGINE.md、docs/3D_RENDERING.md，以及其他领域文档。
本次只实现 E0-01 与 E0-02：初始化 strict TypeScript pnpm monorepo，建立 apps/web、apps/api、apps/worker、packages/domain、packages/chain、packages/world-engine、packages/agent-engine、packages/ui、contracts；设置 BSC Chain ID=56 官方 Agent ID 地址校验，建立 test/lint/typecheck 可执行脚本。
不要实现未经验证的钱包自动签名，不要导入 Pixel AI Town 作为主架构，不要用假交易填充生产数据。最后说明改动文件、实际执行命令/测试结果和 Gate A 仍需真人验证的内容。
```

## 5. 核心系统数据流

```text
Official Agent ID Contract
       │ balanceOf(owner)
       ▼
RepublicRegistry / RepublicCore       AI Agent Runtime
       │ confirmed BSC event                ▲ │ approve-only social action
       ▼                                    │ ▼
Chain Indexer ──► World Engine ──► WorldFrameV1 ◄── Moderated Social Events
                         │                    │
                         │                    └── AgentObservationV1
                         ▼
                 World API + SSE
                         ▼
              3D City + HTML Fallback
```

**Agent ID 是身份和权限根基；AI Agent 是受约束的建议与协商主体；链上合约确认正式行为；世界引擎和 3D 只投影、显示，不创造链上事实。**

## 6. 产品玩法（MVP）

- `District 01`：议会大厅、身份中心、公共建设区、Agent 核心四个地标和中央广场。
- 一个创世公共建设项目：黄金马桶大厦，目标 2000 BUILD；真实进度从链上读取。
- 一个 ID 一个治理席位；注册获得 100 BUILD；首次有效日投票加 20 BUILD、2 REP；贡献每 10 BUILD 加 1 REP（每日上限 10）。
- 两种行为并存：Agent 自主公开协商 / owner 自己确认正式投票与贡献。
- 四个建筑建设阶段随确认链上进度变化；AI 的讨论和角色移动统一标记“AI SIMULATED”。

## 7. 不可绕过的真实世界约束

- 币安公布的官方 Agent ID 主网合约：`0x60b9262456de011f7d15a54cdd8c48baaa8b022f`；`balanceOf(owner)>0` 用于验证。
- Agentic Wallet 自定义合约调用受到官方安全约束，可能需要用户在 App 打开 Developer Mode 并逐次确认；不支持随意 EIP-191 `personal_sign` 或第三方站点采集会话。
- 只有真实钱包能完成 owner 的上链互动。公开比赛资料、奖金和参与门槛以当期 Binance 官方公告为准；本软件不保证达标或获奖。
- 真实钱包验证、生产合约部署和审计状态以对应记录为准。

## 8. 外部权威链接

- Binance Agent ID Hackathon: https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf
- Binance Agentic Wallet: https://web3.binance.com/en/dev-docs/products/agentic-wallet/introduction
- Three.js: https://threejs.org/
- React Three Fiber: https://r3f.docs.pmnd.rs/
- Foundry: https://book.getfoundry.sh/

## 9. 版本与变更

- `docs/WHITEPAPER.md` 保留 v0.1：愿景性质，不覆盖 v1.1 工程具体规格。
- 本 DevPack 的其余工程规格为 v1.1；详见 `CHANGELOG.md`。

## 10. 验证规格包自身

在本地安装 Python 3（不需要第三方依赖），运行：

```bash
python scripts/validate_devpack.py
```

它只检查 Markdown 文档、Demo JSON、稳定哈希、地标包围盒和核心跨文档术语是否一致，**不等同于**后续 Codex 项目的合约单测、端到端测试或真实 Agentic Wallet 钱包验证。
