import { CityMark } from '@/components/CityMark';
import styles from './city-loading.module.css';

const STAGE_LABELS = {
  scene: '正在加载街区模型与场景',
  overview: '正在加载全城地图',
};

export function CityLoading({ stage, onUseStatic, cafeMode = false }: {
  stage: keyof typeof STAGE_LABELS;
  onUseStatic: () => void;
  cafeMode?: boolean;
}) {
  return (
    <section aria-label="进城加载" className={styles.loading}>
      <div className={styles.brand}>
        <CityMark className={styles.mark} />
        <p className={styles.wordmark}>NEXCIV CITY</p>
        <p className={styles.destination}>{cafeMode ? '正在进入咖啡街' : '正在进入城市'}</p>
      </div>
      <div className={styles.controls}>
        <div className={styles.stage} role="status">{STAGE_LABELS[stage]}</div>
        <div className={styles.track} role="progressbar" aria-label="3D 场景加载" />
        <button className={styles.staticButton} type="button" onClick={onUseStatic}>切换到 2D</button>
      </div>
    </section>
  );
}
