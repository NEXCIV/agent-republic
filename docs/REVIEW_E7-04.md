# AGENT REPUBLIC — E7-04 A11y / Performance / Security Review

> 日期：2026-11-20
> 范围：`apps/web`、`apps/api`、`apps/worker`、`packages/*`、`db/migrations`、部署配置样例
> 结论先行：**开发/演示环境可继续；生产与主网不具备上线条件。** 阻断项见 §6 R-01～R-04。

| 环境 | 值 |
|---|---|
| OS | Windows 本机开发环境 |
| Node / pnpm | 22.14.0 / 9.15.9 |
| PostgreSQL | 17.5（本地测试库） |
| 浏览器 | Headless Chrome（Playwright 驱动，版本见 E6-07：157） |
| Web | `next build` + `next start -p 3000` |
| API | 响应式检查时未启动；数据页按设计显示 unavailable，不伪造数据 |

本报告只记录本次实际执行的命令与结果。未执行的检查会明确标注“未验证”，不以推测代替结论。

## 1. 复现方式

```bash
cd agent-republic
pnpm install

# 静态与单元/集成
pnpm lint
TEST_DATABASE_URL='postgres://postgres@127.0.0.1:5432/agent_republic_test' pnpm test

# 构建与浏览器检查
pnpm --filter @agent-republic/web build
pnpm test:a11y                       # 新增：CSS token 对比度
pnpm --filter @agent-republic/web exec next start -p 3000   # 终端 A
WEB_BASE_URL=http://127.0.0.1:3000 pnpm test:responsive     # 终端 B
pnpm test:visual                     # 自带 fixture API + 3100 端口

# 依赖漏洞
pnpm audit --prod
```

| 命令 | 实测结果 |
|---|---|
| `pnpm lint` | 通过 |
| `pnpm test`（含 PG 集成 + E2E） | **46 文件 / 461 项通过**，约 33 s（Windows 本机，非性能基准） |
| `pnpm --filter @agent-republic/web build` | 成功；`/world` 5.92 kB / First Load 128 kB，共享 103 kB |
| `pnpm test:a11y` | **13/13** token 对比度通过 WCAG AA 4.5:1 |
| `pnpm test:responsive` | **40/40** 通过（10 路由 × 360/390/1024/1440） |
| `pnpm test:visual` | **35/35** 通过（R-01..R-14 + 触摸/减少动态/无 WebGL） |
| `pnpm audit --prod` | **失败**：5 个漏洞（3 high / 2 moderate） |

## 2. 可访问性（A11y）

### 2.1 已通过的自动检查

- 所有页面具备 `<h1>`、`<main id="main">`、带标签的主导航、skip link。
- 360px 宽度首 Tab 聚焦 skip link，且有可见 focus ring；10 条路由在四种视口均无页面级横向溢出。
- `/world` 键盘选择建筑后 Enter 进入相同业务路由；Escape 清除选择；触屏点击等价。
- `prefers-reduced-motion` 下保留选择交互，不做长动画。
- 无 WebGL / `?no3d=1` 时渲染静态平面图与等价 HTML 建筑目录，目录链接可进入 `/projects`。
- 动态状态使用 `role="status"` / `role="alert"` / `aria-live="polite"`（交易状态、世界帧状态、选择面板）。
- 表格有 `<th scope="col">`；`/my-agent` 表单使用 `<label htmlFor>`（静态代码审查，未在无会话状态下运行时验证）。
- 13 个前景/背景 token 组合均 ≥ 4.5:1（最低为 hint 文本 6.02:1）。

### 2.2 未验证 / 缺口

- 未运行 axe-core、WAI-ARIA 快照或真实屏幕阅读器（NVDA / VoiceOver）回归。
- `/my-agent` 的表单与版本历史在当前构建中处于 401 会话态，实际表单未做运行时 a11y 断言。
- 画布选中后 Escape 的**焦点返回位置**未断言（只断言面板消失）。
- 未单独做 200% 浏览器缩放与高对比度模式（Windows High Contrast）检查。
- 没有认知障碍或真实视障用户测试。

## 3. 性能

### 3.1 构建体积（本次实测）

| 路由 | Route size | First Load JS |
|---|---:|---:|
| `/`、`/projects`、`/council`、`/activity`、`/tx/[hash]` | 171 B | 106 kB |
| `/projects/[id]`、`/council/[id]` | 133 B | 136 kB |
| `/my-agent` | 2.9 kB | 121 kB |
| `/world` | 5.92 kB | 128 kB |
| 共享 chunk | — | 103 kB |

`/world` 的 three.js + R3F 在懒加载 chunk 中；`docs/PERFORMANCE.md`（E6-07）记录实际网络加载约 363 KiB transfer，0 B GLB/纹理。

### 3.2 已有测量（引用 E6-07，未在本任务重测）

- Headless Chrome + SwiftShader：桌面/移动模拟均约 170 FPS、78–83 draw calls、9.3k–9.5k triangles。
- `demand` 渲染：静止时不请求新帧；离屏/隐藏页暂停。
- 30 个 Agent 使用 InstancedMesh；低端设备自动降 DPR。
- 这些是**软件渲染**结果，不代表真实 GPU/手机目标（50–60 / 24–30 FPS）。

### 3.3 未验证 / 缺口

- 未运行 Lighthouse 或 Core Web Vitals（LCP/INP/CLS）实测。
- 无真实 GPU、真实手机、弱网、长时运行/内存增长/温度/耗电测试。
- 无 API 延迟与吞吐压测；`pnpm test` 的 33 s 是测试耗时，不是服务性能指标。
- 未测冷启动与 Next 服务首请求延迟。

## 4. 安全

### 4.1 已核实的安全属性

| 项目 | 证据 |
|---|---|
| 无服务端签名 / 无私钥处理 | `apps/**/src` 无 `signTransaction`/`sendTransaction`/`writeContract`/`privateKey`/`mnemonic`/`eth_sign` |
| 无 `personal_sign` 依赖 | 仅文档说明其不可假设；业务代码未调用 |
| 无危险 HTML / 动态执行 | `apps/**/src` 无 `dangerouslySetInnerHTML`、`eval(`、`new Function(`、`child_process` |
| Owner 保护 | owner 只来自 `identity_bindings`；body 出现 `owner` → `400 OWNER_NOT_ALLOWED`；未绑定 → `403 BINDING_REQUIRED`；E3-07 路由与 PG 测试覆盖 |
| 链上事实边界 | 只有 finalized 事件进入 facts；pending 不推进项目/3D；reorg 回退；E5/E7-01/E7-02 测试覆盖 |
| 交易状态 | 自报 txHash 只到 `SUBMITTED`；`CONFIRMED` 只由索引事件派生；E2-05/E7-01 覆盖 |
| SQL 注入 | 查询使用 `$n` 参数；模板插入仅列名常量、内部 `where` 片段与 `payloadKey` 联合字面量；无用户输入拼接 |
| XSS | React 默认转义；公开消息按文本渲染；无原始 HTML 注入点 |
| 密钥入库 | 仓库无 `.env`；`.env.example` 全部为空占位；扫描未发现私钥/助记词/密钥块 |
| 网络暴露面 | API `listen({ host: '127.0.0.1' })`；未启用 CORS；浏览器只经同源 `/api/*` 代理 |
| 错误泄露 | 500 统一为 `INTERNAL`，不返回堆栈；日志仅服务端 |
| LLM 越权 | 输出 strict schema + deterministic policy；无转账/授权字段；预算硬上限；E3-01/04、E7-03 覆盖 |

### 4.2 依赖漏洞（`pnpm audit --prod` 实测）

| 严重度 | 包 | 漏洞 | 路径 | 修复 |
|---|---|---|---|---|
| High | postcss ≤8.5.11 | 任意文件读取/信息泄露（sourceMappingURL） | `apps/web > next@15.5.29 > postcss@8.4.31` | ≥8.5.12 |
| High | postcss ≤8.5.17 | 路径穿越读取 `.map` | 同上 | ≥8.5.18 |
| High | zod <4.6.6 | 超大受约束集合导致内存耗尽 | 根依赖及 25 条 workspace 路径（`zod@3.25.76`） | ≥4.6.6 |
| Moderate | postcss <8.5.10 | CSS stringify `</style>` XSS | 同上 | ≥8.5.10 |
| Moderate | postcss ≤8.5.22 | 上一修复不完整 | 同上 | ≥8.5.23 |

处理建议（未在本次评审执行，避免无回归验证的依赖升级）：

- PostCSS 属 Next 的构建期传递依赖，运行时攻击面低；可加 `pnpm.overrides: { "postcss": ">=8.5.23" }`，随后必须重跑 `pnpm build` / `test:visual`。
- Zod 3.x 没有列出的修复版本；迁移到 v4 属破坏性变更。当前缓解：所有 schema 对数组/字符串设上限、Fastify 默认 1 MiB body limit；仍应在 E4 前完成升级评估。

### 4.3 未验证 / 缺口

- **没有真实 Web2 会话**：默认 `session` resolver 永远返回 `null`，owner 接口在生产运行态一律 401；当前只证明“拒绝正确”，未证明“登录可用”。
- **无速率限制 / 配额保护**：`/api/v1/identity/:address` 会触发 RPC，SSE 连接无上限，恶意客户端可消耗 RPC 配额或连接数。
- **无安全响应头**：未配置 CSP、HSTS、`X-Frame-Options`、`Referrer-Policy`。
- **配置“加密”名不副实**：`agent_configs.config_json_encrypted` 实际存 UTF-8 明文 JSON（E3-07 已知风险）。
- **无 CSRF 方案**：当前无 cookie 会话，暂无 CSRF 面；接入会话时必须同时设计 CSRF 与 SameSite。
- **无渗透测试 / 依赖更新策略**；本报告不是安全认证。
- **LLM 预算不持久**：`llm_usage` 表存在但未接线，进程重启后除非加载账本，否则预算重置。
- **主网/Gate A 未执行**：无真实钱包注册、无部署、无 BscScan 验证、无真实用户交易证据（E4-01/E4-03 仍 BLOCKED）。

## 5. 测试覆盖信号

- 461 项测试覆盖 schema、reducer、索引/重组、绑定、intent、世界帧、3D 阶段、Agent planner/policy/debate/memory、预算与 E2E 证据链。
- 失败态被显式测试：pending 不计账、reorg 回退与重确认、RPC 不可用、空索引、LLM 关闭、无 WebGL、owner 篡改、版本冲突。
- 尚未覆盖：真实浏览器安全头、DoS/限流、超大会话/消息、真实设备性能、真实钱包。

## 6. 遗留风险清单

| ID | 严重度 | 领域 | 问题 | 处理建议 | 状态 |
|---|---|---|---|---|---|
| R-01 | **Blocker** | 主网 | Gate A 真机验证待完成，尚无真实注册交易证据 | 由持有人用官方钱包完成注册交易并留证 | [只读预检通过](#8-e1-00-钱包验收预检2026-11-27) |
| R-02 | **High** | 身份 | 无 Web2 登录/会话；owner 接口运行态全 401 | 接入 passkey/email 会话，补 CSRF/SameSite 测试 | 未开始 |
| R-03 | **High** | 可用性/安全 | 无速率限制；identity 触发 RPC、SSE 无连接上限 | 增加按 IP/账户限流、SSE 上限与超时 | 未开始 |
| R-04 | **High** | 依赖 | PostCSS 3 个 high + 2 个 moderate；Zod high | 评估 override/升级；升级后跑 build + visual + E2E | 已披露 |
| R-05 | Medium | 数据 | `config_json_encrypted` 明文存储 | 实施 KMS/应用层加密，或改名并开 ADR | 已披露 |
| R-06 | Medium | 传输 | 缺 CSP/HSTS/X-Frame-Options/Referrer-Policy | 在 Next/反向代理配置安全头 | 未开始 |
| R-07 | Medium | LLM 成本 | 预算守卫在进程内，`llm_usage` 未接线 | 启动时加载当日账本并持久化每次调用 | 部分实现 |
| R-08 | Medium | A11y | 无 axe/屏幕阅读器/高对比度实测 | 引入 axe-core CI + 人工 SR 走查 | 未开始 |
| R-09 | Low | 性能 | 无 Lighthouse/CWV/真机数据 | 真机跑 CWV 与长时内存测试 | 未开始 |
| R-10 | Low | 安全流程 | 无渗透测试与依赖更新 SLA | E4 前安排外部评审/升级窗口 | 未开始 |

## 7. 结论

- **开发与演示**：本次 A11y/性能/安全基线可接受；失败态与 owner 保护有自动化证据。
- **生产/主网**：不通过。R-01（Gate A）、R-02（会话）、R-03（限流）、R-04（依赖漏洞）必须先解决；R-05～R-10 需在上线前逐项关闭或有书面接受记录。
- 本报告不构成安全保证；所有“通过”仅指所列命令在本次环境中的结果。

## 8. E1-00 钱包验收预检（2026-11-27）

| 检查 | 实测结果 |
| --- | --- |
| 官方 Agent ID 主网读取 | BNB Smart Chain 的 `eth_chainId` 返回 56。官方 Agent ID 合约有部署字节码。在区块 `135998074` 查询，真实铸造样本的 `balanceOf` 返回 `1`，对照地址 `0x000000000000000000000000000000000000dead` 返回 `0`。 |
| 绑定挑战、失败路径与确认状态 | 编码和 API 测试 27 项通过。因没有配置独立 PostgreSQL 测试库，10 项数据库集成测试跳过。 |
| 真机注册与账号绑定 | **BLOCKED**。仓库没有主网 Registry/Core 部署清单，运行环境未配置上述地址，生产会话提供方尚未接入。尚无用户注册交易或账号绑定的主网证据。 |

主网只读查询使用 [BNB Chain 官方 RPC](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/) 和 [活动公告中的 Agent ID 合约](https://www.binance.com/zh-CN/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf)。正样本取自 [官方合约铸造交易](https://bscscan.com/tx/0x55731dc509f95d487bb070739e23347d5a1b465c66ee6a6989dd78b3a20ef140) 回执的 `Transfer` 事件，日志索引为 `0x14a`。复测时从该日志取接收地址，对两个地址在同一近期区块调用 `balanceOf`。需要复核原区块状态时应使用支持历史查询的 RPC。原区块哈希为 `0x30465c2bec602f8e2f684fa0be4aa8ba4bddba61ad06782d22bd64522e620ea0`。

```sh
pnpm exec vitest run packages/chain/test/binding.test.ts apps/api/test/binding-routes.test.ts apps/api/test/binding-pg.test.ts
```

完成验收需要以下步骤。

1. 确认受控的 BSC 主网 Registry/Core 地址，核验已部署代码和两合约的关联，并确认 Registry 引用的是官方 Agent ID 合约。
2. 接好站内登录会话和绑定接口，通过已登录账号生成与持有地址匹配的一次性挑战，检查交易链、目标、`registerCitizen(commitment)` 和零转账金额。
3. 由实验参与者本人在支持的官方钱包流程里确认注册。持有人可以提供公开交易哈希用于核验。[币安钱包操作规范](https://web3.binance.com/en/dev-docs/products/agentic-wallet/introduction#verified-capabilities-only)
4. 检查成功回执、确认区块、交易发起地址、Registry 的 `CitizenRegistered` 事件及匹配的 commitment。只有索引确认并由绑定接口返回 `BOUND`，才记录账号绑定通过。
