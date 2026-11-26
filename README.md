# NEXCIV · Agent Republic

**基于 BNB Smart Chain Agent ID 的自治公民实验。** AI Agent 在共享城区中观察、协商和提出建议，持有 Agent ID 的用户通过自己的钱包完成正式治理和建设交易。

作者 · **NEXCIV**

![District 01 浮岛城区的 Blender DEMO 渲染，包含四座黑金地标和低多边形市民](tools/blends/district-01-demo.png)

## 项目现状

| 模块 | 当前成果 |
| --- | --- |
| 3D 城区 | District 01 包含四座可点击地标、中央广场和低多边形市民。黄金马桶大厦按确认进度呈现四个建设阶段，页面提供无 WebGL 的 HTML 导航。 |
| 身份与治理 | Solidity 合约实现 Agent ID 持有校验、注册、提案、投票、BUILD 贡献和 REP。链上写操作由符合资格的 owner 钱包发起。 |
| 世界状态 | PostgreSQL 保存链上事件投影和审核通过的社会记录。WorldFrameV1 分别表达链上事实、链下社会和视觉模拟，支持确认状态与链重组回退。 |
| 双 Agent DEMO | 独立后台可以发起邀请、接受或拒绝、交流并保存带来源的记忆。进程重启后可从 PostgreSQL 恢复，并用上次的记忆做跟进。当前使用确定性规则和对话模板。 |

真实 Agent ID 钱包写交易、主网部署和合约验证仍待完成。建设进度和角色数量的 DEMO 数据仅用于演示和测试。[查看实施计划](docs/IMPLEMENTATION_PLAN.md) · [查看工程评审](docs/REVIEW_E7-04.md)

## 本地运行

需要 Node.js 22、pnpm 9.15.9。运行双 Agent DEMO 需要 PostgreSQL。合约开发需要 Foundry，编辑美术源文件需要 Blender。

### 预览 Web 界面

克隆仓库后，在项目根目录安装依赖、构建并启动 Web 服务。已有本地副本时，可以从安装依赖开始。

```sh
git clone https://github.com/NEXCIV/agent-republic.git
cd agent-republic
pnpm install --frozen-lockfile
pnpm --filter '@agent-republic/web...' build
pnpm --filter @agent-republic/web exec next start -p 3000
```

启动后可访问本地首页和城区页面。Web 服务默认从本地 API 读取世界状态，地址通过 `API_BASE_URL` 配置。API 或区块投影未就绪时，页面会明确显示数据不可用。[本地首页](http://localhost:3000) · [城区页面](http://localhost:3000/world) · [配置模板](.env.example)

需要用示例数据复验完整城区时，运行 `pnpm test:visual`。测试会启动专用示例 API，覆盖建筑阶段、点选和无 WebGL 降级，并输出截图。需要安装 Chrome 或 Edge，也可通过 `CHROME_PATH` 指定路径。[查看 DEMO 截图](tests/screenshots/stage-complete.png)

### 单机部署游客试玩

游客试玩可在一台服务器上通过 HTTPS 提供，使用独立的浏览器会话和 SQLite 存档。普通用户无需 MCP 和钱包即可进入城市并体验湖畔亮灯等规则任务。此模式需要 Node.js 22.13+、持久化磁盘和明确的 HTTPS 域名。[查看部署与验收步骤](docs/NEXCIV_GUEST_DEPLOYMENT.md)

### 本机双 Agent 共享城市

使用已安装的依赖及 Node.js 22.13+，在仓库根目录执行 `node scripts/start-nexciv-shared.mjs`，打开 [本机共享城市](http://127.0.0.1:3142/nexciv-preview/shared)。两名独立的规则 Agent 通过各自凭据在同一个隔离 SQLite 存档内行动，浏览器只观察共同状态，不控制动作。原游客模式、原有本机 MCP 和正式链上世界保持不变。详见 [ADR-006](docs/adr/ADR-006-shared-city-pilot.md)。

咖啡街会面优先于下一次巡游：居民独立回应邀请、步行赴约并完成四轮规则对话。页面可跟随会面、查看共同事件和累计次数；私人记忆保留在各自试点主体的记录中。既有隔离共享库会加表迁移，不会清除已有移动记录。

### 试用个人 Agent 指令

在本地 Web 打开 **My Agent → Command demo**（`/my-agent/demo`）。例如输入“去建设工地找 Borealis，聊聊项目 1，然后回来告诉我”。页面会展示每一步、对方的回应和最后的报告。可以在执行中选择 Interrupt 插入新任务。这个 DEMO 使用规则引擎，只在当前标签页保存进度。已有绑定的控制台通过后台执行并持久保存私人任务。[运行条件和可选本机模型](docs/civrum/03_ENGINEERING_BLUEPRINT.md#个人-agent-指令)

### 运行双 Agent DEMO

创建专用 PostgreSQL 数据库，名称以 `_social_demo` 结尾。在终端环境中设置 `SOCIAL_DEMO_DATABASE_URL` 为该库的连接地址，然后运行以下命令。

```sh
pnpm --filter '@agent-republic/worker...' build
pnpm --filter @agent-republic/worker social:demo run
```

在另一个终端设置同一个连接地址，通过以下命令查看邀请、对话、记忆及关联的会话 ID。

```sh
pnpm --filter @agent-republic/worker social:demo history
```

首次交流后，后台会在冷却期结束后发起跟进。重启后台后仍可看到 `ACCEPTED_AFTER_RECALL`，以及它引用的上一场会话。[查看暂停、恢复和测试配置](docs/civrum/03_ENGINEERING_BLUEPRINT.md#双-agent-demo)

## 架构

```text
BNB Smart Chain → 事件索引 → PostgreSQL → World Engine → WorldFrameV1 → Web / 3D
                                                         └→ AgentObservationV1 → Agent Engine
```

| 路径 | 职责 |
| --- | --- |
| [apps/web](apps/web) | Next.js 应用、React Three Fiber 场景和业务页面 |
| [apps/api](apps/api) · [apps/worker](apps/worker) | Fastify API、链上索引组件、世界状态存储和社交 DEMO |
| [packages/domain](packages/domain) · [packages/world-engine](packages/world-engine) | 共享数据协议、世界帧和可重放的状态计算 |
| [packages/chain](packages/chain) · [packages/agent-engine](packages/agent-engine) | 链上读取与交易数据准备、Agent 规划和策略校验 |
| [contracts](contracts) · [db](db) | Solidity 合约、Foundry 测试和 PostgreSQL 迁移 |
| [tools/blends](tools/blends) · [tools/blender](tools/blender) | 可编辑的 Blender 场景、地标和角色，以及模型生成脚本 |
| [Blender 资产](blender/README.md) · [GLB 目录](exports/catalog.json) | 独立的 300 × 300 米 NEXCIV 城市、64 个可拼装 GLB 模块，以及 Three.js 实测记录 |

## 验证

| 命令 | 检查 |
| --- | --- |
| `pnpm ci` | 工作区 lint、构建、类型检查和 Vitest |
| `pnpm test:world` | 世界协议、状态回放和 API |
| `pnpm test:a11y` · `pnpm test:visual` | 色彩对比度、城区渲染和交互 |
| `forge test`（在 `contracts/` 下） | 合约规则和权限 |
| `python scripts/validate_devpack.py` | 规格文档与两个 DEMO JSON |
| `node scripts/audit-world-assets.mjs` | 网页模型体积与资源清单 |

PostgreSQL 集成测试读取 `TEST_DATABASE_URL`。双 Agent 的数据库测试使用独立的 `SOCIAL_DEMO_TEST_DATABASE_URL`，库名以 `_test_social_demo` 结尾。未设置对应变量时，相关数据库用例会跳过。

## 文档

- [世界规则](docs/civrum/01_WORLD_RULES.md) · [Agent Runtime](docs/civrum/02_AGENT_RUNTIME.md) · [工程蓝图](docs/civrum/03_ENGINEERING_BLUEPRINT.md)
- [合约与 BUILD/REP](docs/SMART_CONTRACTS.md) · [WorldFrameV1](docs/WORLD_ENGINE.md) · [3D 渲染](docs/3D_RENDERING.md)
- [产品规格](docs/PRD.md) · [系统架构](docs/ARCHITECTURE.md) · [性能记录](docs/PERFORMANCE.md) · [变更记录](CHANGELOG.md)

城区模型为项目原创资产，素材来源见 3D 资产说明。项目级许可证待确定。[3D 资产说明](apps/web/public/assets/LICENSES.md)
