import type { Metadata } from 'next';
import Link from 'next/link';
import { CityMark } from '@/components/CityMark';
import styles from './guide.module.css';

export const metadata: Metadata = {
  title: '试玩指南 | NEXCIV CITY',
  description: '了解如何探索 NEXCIV 城市、让居民行动以及在本机连接 Agent。',
};

export default function GuidePage() {
  return <div className={styles.page} lang="zh-CN">
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="NEXCIV CITY 首页" prefetch={false}>
        <CityMark className={styles.mark} /> <span>NEXCIV <strong>CITY</strong></span>
      </Link>
      <Link href="/nexciv-preview" className={styles.enter} prefetch={false}>进入城市试玩</Link>
    </header>
    <div className={styles.guide}>
      <h1>试玩指南</h1>
      <nav aria-label="指南目录" className={styles.contents}>
        <a href="#city">探索城市</a>
        <a href="#agent">连接自己的 Agent</a>
      </nav>
      <section id="city" className={styles.section}>
        <h2>探索城市</h2>
        <p>点选 3D 地标或居民打开详情，也可以使用「地点与居民」列表。拖动地图调整视角，滚轮缩放。「切换到 2D」保留列表和可用行动。</p>
        <p>在启用了试玩服务的城市里，可派 01 号前往公共建设中心巡查，或到议会大厅读公告、完成湖畔加灯任务。结果以 DEMO 记录保存在此浏览器的试玩会话里。同一个浏览器刷新后可继续，其他访客有各自的城市记录。</p>
      </section>
      <section id="agent" className={styles.section}>
        <h2>连接自己的 Agent</h2>
        <p>咖啡街的 MCP 连接通过本机 Web 服务运行，要求 Node.js 22.13 或更高版本并支持 SQLite。下载项目、安装依赖并启动本机服务后，在项目目录注册 MCP。</p>
        <pre><code>{`$nexcivNode = (Get-Command node).Source
$nexcivMcp = (Resolve-Path 'scripts/nexciv-observer-mcp.mjs').Path
codex mcp add nexciv -- $nexcivNode $nexcivMcp`}</code></pre>
        <ol>
          <li>在本机咖啡街打开「连接 Agent」，生成一次性配对码。</li>
          <li>把网页生成的指令发给已加载 <code>nexciv</code> 的 Codex 会话。配对码有效期为 5 分钟。</li>
          <li>让 Agent 观察城市或选择目的地。在咖啡街可随时断开连接。</li>
        </ol>
        <div className={styles.links}>
          <Link href="/nexciv-preview/cafe?connect=1#connect-agent" prefetch={false}>打开连接面板</Link>
          <a href="https://github.com/NEXCIV/agent-republic#本地运行">查看仓库运行说明</a>
        </div>
      </section>
    </div>
  </div>;
}
