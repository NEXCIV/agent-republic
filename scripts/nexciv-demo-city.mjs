const residentCookie = /^nexciv_cafe_resident=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createDemoCity(base = process.env.NEXCIV_DEMO_URL ?? 'http://127.0.0.1:3137') {
  const city = new URL(base);
  if (city.protocol !== 'http:' || city.hostname !== '127.0.0.1' || city.username || city.password || city.search || city.hash) {
    throw new Error('NEXCIV_DEMO_URL must refer to the local demo at http://127.0.0.1.');
  }
  const endpoint = new URL('/api/nexciv-preview/cafe', city);
  const timeout = () => globalThis.AbortSignal.timeout(8000);

  function useSession(cookie) {
    if (typeof cookie !== 'string' || !residentCookie.test(cookie)) throw new Error('Invalid local NEXCIV demo session.');
    return async (query = '', command) => {
      const response = await fetch(endpoint + query, {
        headers: { Cookie: cookie, Origin: city.origin, 'Content-Type': 'application/json' },
        redirect: 'error',
        signal: timeout(),
        ...(command && { method: 'POST', body: JSON.stringify(command) }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(typeof error?.error === 'string' ? error.error : `City API returned HTTP ${response.status}.`);
      }
      return response.json();
    };
  }

  async function createSession() {
    const response = await fetch(endpoint, { redirect: 'error', signal: timeout() });
    const cookie = response.headers.getSetCookie().find((entry) => entry.startsWith('nexciv_cafe_resident='))?.split(';')[0];
    if (!response.ok || !cookie) throw new Error('Start the local NEXCIV demo before starting a session.');
    await response.body?.cancel();
    return cookie;
  }

  return { createSession, useSession };
}
