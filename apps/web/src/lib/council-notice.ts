import type { CityPoint } from './cafe-geometry';

// The display sits on the front face of the east forecourt kiosk, turned 15 degrees.
export const COUNCIL_NOTICE_BOARD: CityPoint = [7.721, 1.58, -77.704];
const readingPoint: CityPoint = [7.35, 0.182, -76.3];
export const COUNCIL_NOTICE_APPROACH: CityPoint[] = [[8, 0.182, -77], readingPoint];
export const COUNCIL_NOTICE_READING_SPOT = { x: readingPoint[0], z: readingPoint[2] };
export const COUNCIL_DEMO_AGENDA = ['湖畔步道增设路灯', '社区剧场开放时段'] as const;
