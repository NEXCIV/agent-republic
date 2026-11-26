export const LOCAL_DEMO_ENDPOINT = '/api/nexciv-preview/cafe';
export const GUEST_DEMO_ENDPOINT = '/api/nexciv-preview/guest';

export function demoEndpoint(hostname = window.location.hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' ? LOCAL_DEMO_ENDPOINT : GUEST_DEMO_ENDPOINT;
}

export function demoRetryDelay(response: Response, fallback: number) {
  if (response.status !== 429) return fallback;
  const seconds = Number(response.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(2_147_483_647, Math.max(fallback, seconds * 1000)) : 10_000;
}
