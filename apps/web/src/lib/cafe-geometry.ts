export type CityPoint = [number, number, number];

const pavement = 0.184;
export const CAFE_CROSSING_X = 8.65;
const crossingX = CAFE_CROSSING_X;
const marketJunction: CityPoint = [crossingX, pavement, 58.15];

export const CAFE_STALL: CityPoint = [12.60, pavement, 74];
export const CAFE_COUNTER: CityPoint = [12.60, pavement, 72.18];
export const CAFE_HOST: CityPoint = [10.95, pavement, 72.15];
export const CAFE_BENCH: CityPoint = [16, pavement, 72.35];
export const CAFE_BENCH_FRONT: CityPoint = [CAFE_BENCH[0], pavement, CAFE_BENCH[2] - 0.65];
export const FISHING_SPOT: CityPoint = [73.65, 0.09, -190];

const counterToMarketSidewalk: CityPoint[] = [
  CAFE_COUNTER,
  [CAFE_COUNTER[0], pavement, 70.85],
  [10.95, pavement, 70.05],
  [crossingX, pavement, 69.55],
  [crossingX, pavement, 67.80],
  [crossingX, 0.038, 67.20],
  [crossingX, 0.038, 60.95],
  [crossingX, pavement, 60.35],
];

function marketCrossing(route: CityPoint[]) {
  let nearest = 0;
  let distance = Infinity;
  for (const [index, [x, y, z]] of route.entries()) {
    const metres = Math.hypot(x - marketJunction[0], y - marketJunction[1], z - marketJunction[2]);
    if (metres < distance) {
      distance = metres;
      nearest = index;
    }
  }
  if (distance > 0.75) throw new Error('The café crossing must meet the market sidewalk route');
  return nearest;
}

export function cafeApproach(marketRoute: CityPoint[]) {
  return [...counterToMarketSidewalk, marketRoute[marketCrossing(marketRoute)]!];
}

export function joinCafeToPier(marketToPier: CityPoint[]) {
  return [...counterToMarketSidewalk, ...marketToPier.slice(marketCrossing(marketToPier))];
}
