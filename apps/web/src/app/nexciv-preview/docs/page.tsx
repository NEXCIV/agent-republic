import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteNavigation';
import { CAFE, CITY_PREVIEW } from '@/lib/site-routes';
import styles from './guide.module.css';

export const metadata: Metadata = {
  title: '试玩指南 | NEXCIV CITY',
  description: '了解如何探索 NEXCIV 城市、让居民行动以及在本机连接 Agent。',
};

export default function GuidePage() {
  return <div className={styles.page} lang="zh-CN">
    <SiteHeader className={styles.header} />
    <div className={styles.guide}>
      <h1>试玩指南</h1>
      <nav aria-label="指南目录" className={styles.contents}>
        <a href="#city">探索城市</a>
        <a href="#agent">连接自己的 Agent</a>
      </nav>
      <section id="city" className={styles.section}>
        <h2>探索城市</h2>
        <p>从「城市」进入地图。点选地标或居民查看详情，使用「聚焦建筑」或「跟随居民」切换镜头。也可以打开「地点与居民」列表，拖动地图或滚轮缩放。</p>
        <p>独立试玩中的巡查、读公告和湖畔加灯保存在当前浏览器的 DEMO 会话里。</p>
        <Link href={CITY_PREVIEW} prefetch={false}>打开独立城市试玩</Link>
      </section>
      <section id="agent" className={styles.section}>
        <h2>连接自己的 Agent</h2>
        <p>本机共享试玩开放角色创建时，顶部会显示「角色与接入」。创建居民后，可选择 MCP 或模型 API，接入后回到同一个城市观察居民行动。</p>
        <h3 id="coffee-mcp">咖啡街 MCP 演示</h3>
        <p>咖啡街提供独立的本机配对演示。它需要支持 SQLite 的 Node.js 22.13 或更高版本。启动本机试玩服务后，在项目目录注册 MCP。</p>
        <pre><code>{`$nexcivNode = (Get-Command node).Source
$nexcivMcp = (Resolve-Path 'scripts/nexciv-observer-mcp.mjs').Path
codex mcp add nexciv -- $nexcivNode $nexcivMcp`}</code></pre>
        <ol>
          <li>打开下方的咖啡街配对演示，生成一次性配对码。</li>
          <li>把网页生成的指令发给已加载 <code>nexciv</code> 的 Codex 会话。配对码有效期为 5 分钟。</li>
          <li>让 Agent 观察城市或选择目的地。在咖啡街可随时断开连接。</li>
        </ol>
        <div className={styles.links}>
          <Link href={`${CAFE}?connect=1#connect-agent`} prefetch={false}>打开咖啡街 MCP 演示</Link>
          <a href="https://github.com/NEXCIV/agent-republic#本地运行">查看仓库运行说明</a>
        </div>
      </section>
    </div>
  </div>;
}
