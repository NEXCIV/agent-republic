# NEXCIV 桌面游客试玩部署

对应 `E6-05` 与 `E7-04` 的 Web 试玩部署。首轮使用一台机器、一个 Next.js 进程和独立游客 SQLite 存档。游客行为、任务回执、路灯的视觉变化均属于 DEMO，链上公民身份、治理、BUILD 与 REP 继续由现有正式系统负责。

## 1. 部署环境

- Node.js 22.13 或更高版本，pnpm 9.15.9，支持 `node:sqlite` 的运行时。
- 已准备一个可以解析到服务器的域名，支持 HTTPS 的反向代理（下文以 Caddy 2.10+ 为例）。
- 服务器上的独立服务账号。游客 DB 和密钥持久存储到该账号可读写的私有目录。
- 从已审核的 Git 提交创建独立工作目录，使用提交内跟踪的 Web 资产。

首轮只运行一个 Next.js 进程和一个游客 DB。该版本的资源限额按单进程设计，暂不运行多个副本、共享数据库或无持久磁盘的函数实例。游客服务单独部署，不需要 PostgreSQL、Redis、外部模型密钥或钱包。正式 API 未部署时，首页公共账本仍显示实际的不可用状态。

当前试玩开放咖啡街、城市观察、城市公共建设与湖畔点灯的体验。每个游客浏览器保存独立的 DEMO 模拟世界；进度不会广播给其他游客，不是多人共享世界。外部 MCP、正式链上治理与夜间剧场尚不开放。

首轮容量保护（配置固定，避免把限额误认为性能压测结果）：

| 限额 | 当前值 |
| --- | --- |
| 活跃游客会话 | 全部浏览器共 100 个 |
| 新会话 | 全部浏览器共每小时 20 个 |
| 写入请求尝试 | 每会话每分钟 12 次，总计 300 次 |
| 读取请求 | 每会话每分钟 180 次 |
| 会话有效期 | 自创建起 30 天 |

游客身份为仅限游客 API 路径的 Secure / HttpOnly / SameSite=Strict cookie，浏览器清除 cookie 或有效期结束后不能保证恢复该进度。触发请求限额时等待 API 返回的 `Retry-After`，进度不依赖浏览器自行生成身份。读请求限额按单进程计算，新会话和写入额度持久化。这些是存档与资源限额，不是真实身份认证或完整的反机器人系统。

## 2. 安装与构建

以下命令以 Linux shell 为例，在指定发布提交的独立项目目录和服务账号下执行。

```sh
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm --filter '@agent-republic/web...' build
```

没有 Corepack 时先单独安装指定版本的 pnpm。构建阶段需要访问锁定依赖和 Next.js 字体下载源。静态 GLB 与贴图位于 `apps/web/public/nexciv-walk`，生产服务依赖完整的 `apps/web/public`、`.next` 产物和工作区依赖。使用更新后的 Git 提交重新安装与构建，保留运行状态目录。

当前城市 Web 资源目录约 128 MiB，其中主城区俯视 GLB 约 33 MiB（不代表所有资源会一次加载）。以 8 Mbps 服务器上行带宽计算，单个未缓存的该 GLB 首次传输理论下限约为 35 秒，多位访客并发会共享带宽，实际加载时间还包含其他请求、网络和渲染开销。2 核 / 4 GB 的单机可先作为小范围验证目标，构建建议在独立构建机完成；真实并发容量与加载时间需要实测，不能仅凭配置判断。此部署不压缩或重做用户提供的模型。

## 3. 配置运行时与 HTTPS

在 Web 文件树之外准备私有目录，例如 `/var/lib/nexciv-guest`。让游客服务账号拥有其读写权限，密钥保持稳定并单独备份。下列域名是示例，请换成实际已配置的 HTTPS 域名。

在服务账号的 shell 中创建一次私有配置文件。配置文件只需执行一次，后续重启沿用同一文件。

```sh
umask 077
mkdir -p "$HOME/.config/nexciv"
(
  set -C
  {
    printf '%s\n' 'NEXCIV_GUEST_ORIGIN=https://city.example.com' \
      'NEXCIV_GUEST_DB=/var/lib/nexciv-guest/guest.sqlite' \
      'NEXCIV_GUEST_PORT=3000'
    printf 'NEXCIV_GUEST_SECRET=%s\n' "$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
  } > "$HOME/.config/nexciv/guest.env"
)
```

配置文件生成后替换示例域名，确认 DB 目录存在并且权限正确。`NEXCIV_GUEST_ORIGIN` 必须是完整 HTTPS origin，没有末尾斜杠和额外路径。`NEXCIV_GUEST_DB` 指向新的游客数据库，专用于此模式。`NEXCIV_GUEST_SECRET` 是 32 个随机字节编码后的 base64url 字符串，服务启用时保持相同值。密钥为运行时服务端配置，勿放进公开的 `NEXT_PUBLIC_*` 变量或静态文件。

生产启动时在独立 shell 中导入变量。游客模式不同时开启本机 café 数据库。

```sh
set -a
. "$HOME/.config/nexciv/guest.env"
set +a
unset NEXCIV_CAFE_DEMO_DB
node scripts/start-nexciv-guest.mjs
```

启动器检查必需配置，要求已有 Next.js 生产构建，并仅监听 `127.0.0.1`。端口默认 `3000`。用系统进程管理器管理上述启动命令，确保机器重启后从私有环境文件恢复变量。Net 端口仅暴露代理的 TCP 80/443，Web 进程端口保持本机访问。

在服务器的 HTTPS 反代配置中使用与 `NEXCIV_GUEST_ORIGIN` 一致的域名。例如以下 Caddyfile：

```caddyfile
city.example.com {
  @localOnly path /api/nexciv-preview/cafe /api/nexciv-preview/cafe/*
  respond @localOnly 404

  @ownerApi path /api/my-agent /api/my-agent/*
  respond @ownerApi 404

  @cityAssets {
    method GET HEAD
    path /nexciv-walk/*
  }
  header @cityAssets Cache-Control "public, max-age=300, must-revalidate" {
    match status 2xx 304
  }

  request_body {
    max_size 32KB
  }
  reverse_proxy 127.0.0.1:3000
}
```

代理需保留规范 `Host`、设置正确的 `X-Forwarded-Proto: https`，并且自身不可把代理前的任意协议或域名声明传给应用（参考 [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) 与 [request_body](https://caddyserver.com/docs/caddyfile/directives/request_body)）。游客 API 响应为 `private, no-store`，不得缓存。这里只为当前未经内容哈希版本化的城市静态资产启用 5 分钟短缓存，过期后重新验证，保留 Next.js 的 ETag/Last-Modified；不可将同名 GLB 配置成永久缓存。其余页面和资源遵循 Next.js 的策略（参考 [Caddy header](https://caddyserver.com/docs/caddyfile/directives/header) 与 [Next.js public](https://nextjs.org/docs/pages/api-reference/file-conventions/public-folder)）。

实际服务器在加载代理配置前运行 `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`，确保配置校验成功。下文的公网 HTTPS 验收依然必须由实际部署后执行。

## 4. 首轮验收

在不使用正式存档的独立构建目录，可先运行启动器配置检查及本机生产 smoke：

```sh
node --test scripts/start-nexciv-guest.test.mjs
NEXCIV_TEST_PRODUCTION_LAUNCH=1 node --test scripts/start-nexciv-guest.test.mjs
```

第一条检查不安全或不完整配置被拒绝；第二条需要预先完成生产构建，临时启动 loopback 服务并使用独立测试 DB，确认未启用本机 café、非 HTTPS 游客请求被拒绝、模拟代理元数据下可获取安全游客会话。测试不修改正式存档，也不替代真实 HTTPS 与浏览器验收。

部署后由两个独立浏览器上下文分别通过真实 HTTPS 地址进入。

1. 在城市内点击建筑或居民，完成议会大厅公告、湖畔两个点位调研、提交报告，并领取 02 号的安装任务。完成后看到湖畔灯光，刷新页面核对场景和回执一致。
2. 另一个浏览器开始时拥有自己的独立进度；完成自己的任务不改变前一个浏览器的记录。切换 2D，确认原有操作和记录仍可查看。
3. 日常重启单台服务后重访此前的浏览器，核对同一记录和同一灯光继续存在。保持原来密钥、origin 与数据库路径。
4. 从外部核查本机 café MCP 入口和 owner API 不可访问，正式链上事件没有因试玩而新增。生产服务器上不得配置本机 MCP 配对凭据、真人钱包密钥或正式链上写入服务。
5. 使用真实桌面浏览器观察首个 3D 加载耗时、交互卡顿与失败资源请求。保留测试环境、浏览器、Git 提交及截图，记录异常 4xx/5xx 和磁盘容量。根据实测确定首批邀请人数。

## 5. 运维与回滚

SQLite 存档应按数据库一致快照方式定期备份，或者停服务后备份；不能在活跃写入时只拷贝主数据库文件。密钥文件单独加密备份。部署新版本时使用相同 origin、密钥和存档，验证回访，再切换代理流量。回滚前确认数据兼容性；留存数据库及配置的版本备份。

这个部署方案不代表当前项目已完成公开发布或主网验收。待域名、服务器和公网浏览器联调完成才可对外分享实际地址。远程 MCP、共享城市和正式链上身份仍按主计划单独验收。
