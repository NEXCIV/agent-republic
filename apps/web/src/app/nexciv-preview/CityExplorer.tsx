import Link from 'next/link';
import type { ReactNode, RefObject } from 'react';
import { CITY_PLACES } from '../../lib/city-movement';
import type { AgentReport, FollowId, WalkLandmarkId, WalkSelection } from './walk';
import { WORKS_MANAGER } from './CityVisitPanel';
import styles from './preview.module.css';

const LANDMARKS = {
  works: { area: '东区', description: '这里是城市施工与现场巡查的工作点。入口外有等候区和现场管理员。' },
  governance: { area: '北区', description: '居民在这里查阅议事公告，了解正在讨论的公共项目。' },
  market: { area: '中央街区', description: '中央广场旁的街角市集。沿街可以前往咖啡摊和公共座位。' },
  registry: { area: '东区', description: '城市的公民登记服务地标，位于公共建设中心以北。' },
  center: { area: '研究区', description: '西北研究街区的地标，毗邻研究步道与阅览室。' },
} satisfies Record<WalkLandmarkId, { area: string; description: string }>;

const RESIDENTS: Record<FollowId, string> = { '01': '城市居民', '02': '建设工人', '03': '研究人员' };

function residentActivity(report?: AgentReport) {
  const destination = report?.destination ? CITY_PLACES[report.destination] : undefined;
  switch (report?.status) {
    case 'outbound': return destination ? `正在前往${destination}` : '正在街区内移动';
    case 'arrived': return destination ? `已到达${destination}` : '已到达目的地';
    case 'greeting': return '正在和 02 号打招呼';
    case 'loading': return '正在载入居民';
    default: return '居民位置暂不可用';
  }
}

type Props = {
  selection: WalkSelection | null;
  open: boolean;
  sceneState: 'loading' | 'ready' | 'fallback';
  focusActive: boolean;
  residentReport?: AgentReport;
  residentIds: readonly FollowId[];
  workerStatus?: string;
  managerPresent: boolean;
  children?: ReactNode;
  heading: RefObject<HTMLHeadingElement | null>;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (selection: WalkSelection) => void;
  onFocus: (selection: WalkSelection) => void;
};

export function CityExplorer({ selection, open, sceneState, focusActive, residentReport, residentIds, workerStatus, managerPresent, children, heading, onOpen, onClose, onSelect, onFocus }: Props) {
  if (!open) return null;

  const landmark = selection?.kind === 'building' ? LANDMARKS[selection.id] : undefined;
  const manager = selection?.kind === 'person';
  const name = selection?.kind === 'building' ? CITY_PLACES[selection.id]
    : selection?.kind === 'resident' ? `${selection.id} 号居民` : manager ? '现场管理员' : '地点与居民';
  const marketGuest = selection?.kind === 'resident' && selection.id === '02';
  const canFocus = sceneState === 'ready' && (selection?.kind === 'building' || (manager && managerPresent) || (marketGuest && workerStatus)
    || (residentReport !== undefined && residentReport.status !== 'unavailable'));
  const residentStatus = sceneState === 'fallback' ? '静态预览中无法获取实时位置'
    : marketGuest ? workerStatus ?? '在街角市集活动' : residentActivity(residentReport);

  return <aside id="city-explorer" className={styles.explorer} aria-labelledby="city-explorer-title">
    <header className={styles.explorerHeader}>
      {selection && <button className={styles.explorerBack} type="button" onClick={onOpen}>‹ 地点与居民</button>}
      <button className={styles.explorerClose} type="button" onClick={onClose} aria-label="关闭地点与居民面板">×</button>
    </header>
    <h2 ref={heading} id="city-explorer-title" tabIndex={-1} className={styles.explorerTitle}>{name}</h2>
    {selection ? <div className={styles.explorerDetail}>
      <p className={styles.explorerMeta}>{landmark ? landmark.area : selection.kind === 'resident' ? `${RESIDENTS[selection.id]} · 模拟行为` : '公共建设中心 · 模拟居民'}</p>
      {landmark ? <p className={styles.explorerDescription}>{landmark.description}</p> : !manager && <p className={styles.explorerDescription} aria-live="polite">
        {residentStatus}
      </p>}
      <div className={styles.explorerActions}>
        <button type="button" disabled={!canFocus} aria-pressed={focusActive} onClick={() => onFocus(selection)}>
          {selection.kind === 'building' ? '聚焦建筑' : manager ? '聚焦管理员' : '跟随居民'}
        </button>
        {selection.kind === 'building' && selection.id === 'market' && <Link href="/nexciv-preview/cafe" prefetch={false}>查看咖啡街班次</Link>}
      </div>
      {children}
    </div> : <div className={styles.explorerDirectory}>
      <h3>地标</h3>
      <ul aria-label="地标">
        {(Object.keys(LANDMARKS) as WalkLandmarkId[]).map((id) => <li key={id}>
          <button type="button" aria-label={CITY_PLACES[id]} onClick={() => onSelect({ kind: 'building', id })}>
            <span>{CITY_PLACES[id]}</span><small>{LANDMARKS[id].area}</small>
          </button>
        </li>)}
      </ul>
      <h3>居民</h3>
      <ul aria-label="居民">
        {residentIds.map((id) => <li key={id}>
          <button type="button" aria-label={`${id} 号居民`} onClick={() => onSelect({ kind: 'resident', id })}>
            <span>{id} 号居民</span><small>{RESIDENTS[id]}</small>
          </button>
        </li>)}
        {managerPresent && <li>
          <button type="button" aria-label="现场管理员" onClick={() => onSelect(WORKS_MANAGER)}>
            <span>现场管理员</span><small>公共建设中心</small>
          </button>
        </li>}
      </ul>
    </div>}
  </aside>;
}
