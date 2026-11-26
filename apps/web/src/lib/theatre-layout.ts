import type { CityPoint } from './cafe-geometry';

export const THEATRE_STAGE: CityPoint = [-95, 0.412, 88.5];
export const THEATRE_ENTRY_LIGHTS: CityPoint[] = [[-97.45, 0.172, 75.9], [-92.55, 0.172, 75.9]];
export const THEATRE_CLOCK = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai',
});
export const THEATRE_AISLE = {
  '01': {
    wait: [-95.8, 0.172, 76.9], approach: [-96.7, 0.172, 82.8], foot: [-97.1, 0.172, 83.12],
    seat: [-97.63, 0.182, 83.11],
  },
  '03': {
    wait: [-94.2, 0.172, 76.9], approach: [-93.3, 0.172, 82.8], foot: [-92.9, 0.172, 83.12],
    seat: [-92.37, 0.182, 83.11],
  },
} satisfies Record<'01' | '03', Record<'wait' | 'approach' | 'foot' | 'seat', CityPoint>>;
