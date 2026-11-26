import type { CityPoint } from './cafe-geometry';
import placement from './council-notice-placement.json';

// Mount the screen just in front of the authored kiosk face.
const [x, y, z] = placement.kiosk as CityPoint;
export const COUNCIL_NOTICE_HEADING = placement.headingDegrees * Math.PI / 180;
export const COUNCIL_NOTICE_BOARD: CityPoint = [
  x + 0.306 * Math.sin(COUNCIL_NOTICE_HEADING),
  y + 1.398,
  z + 0.306 * Math.cos(COUNCIL_NOTICE_HEADING),
];
const readingPoint: CityPoint = [5.5, 0.182, -77.75];
export const COUNCIL_NOTICE_APPROACH: CityPoint[] = [
  [5.778, 0.182, -78.139], readingPoint,
  // Retain the paved connection for browser sessions saved at the previous reading spot.
  [7.35, 0.182, -76.3], [8, 0.182, -77],
];
export const COUNCIL_NOTICE_READING_SPOT = { x: readingPoint[0], z: readingPoint[2] };
export const COUNCIL_DEMO_AGENDA = ['湖畔步道增设路灯', '社区剧场开放时段'] as const;
export const COUNCIL_SURVEY_RECEIPT = '已收到调研报告';
