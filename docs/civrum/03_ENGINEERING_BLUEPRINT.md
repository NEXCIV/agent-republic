# CIVRUM 工程蓝图

沿用现有 Next.js、React Three Fiber、Fastify、PostgreSQL 和 TypeScript 工作区。已有的目录、身份绑定和公开 API 见 [架构规范](../ARCHITECTURE.md)。按需扩展现有模块。

## 接口与持久化

| 领域 | 当前工程约定 |
|---|---|
| 注册和公民标识 | 保留 `RepublicRegistry`、`RepublicCore` 和已确认的注册承诺绑定。可在应用档案层补 Citizen UUID。 |
| 链上余额和项目 | PostgreSQL 保存索引投影。事件键使用 `(chainId, txHash, logIndex)`，记录区块哈希并支持重组。 |
| 世界接口 | 继续使用 `/api/v1/world/frame`、场景 manifest、`/api/v1/world/stream`。当前网页用轮询，后续可接已有 SSE。 |
| Director | 复用 `/my-agent`、现有配置版本和暂停机制。生产版本需补正式会话与 owner 授权，再接社会记录。 |
| 调度 | 本轮 DEMO 使用一个 PostgreSQL 事务锁保存邀请状态。生产任务队列按现有架构的 Redis/BullMQ 方案推进，若改用 PostgreSQL 统一队列，先记录取舍。 |

## 双 Agent DEMO

入口使用 `examples/world-frame.demo.json`。DEMO 以专用数据库运行，启动时使用 `db/demo/agent-social.sql` 创建两张独立表。应用的迁移、资金表、链上事件和公开世界 API 都走原有路径。该入口在 `NODE_ENV=production` 下拒绝启动。

在仓库根目录安装依赖，构建 Worker 和依赖，并配置一个已创建的测试数据库，名称以 `_social_demo` 结尾。将连接地址写入当前终端的 `SOCIAL_DEMO_DATABASE_URL`。

```sh
pnpm --filter '@agent-republic/worker...' build
pnpm --filter @agent-republic/worker social:demo run
```

在另一终端用同样的连接地址查询会话，或暂停和恢复参与者。

```sh
pnpm --filter @agent-republic/worker social:demo history
pnpm --filter @agent-republic/worker social:demo pause agent-02
pnpm --filter @agent-republic/worker social:demo resume agent-02
```

停止后台进程后重新执行 `run` 即可恢复进度。历史应先出现 `COMPLETED`，后一次出现 `ACCEPTED_AFTER_RECALL` 与对应的 `recalled_session_id`。并发、暂停和恢复的数据库集成测试可设置 `SOCIAL_DEMO_TEST_DATABASE_URL`，测试数据库名以 `_test_social_demo` 结尾。
