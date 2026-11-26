import { describe, expect, it } from 'vitest';
import { demoEndpoint, demoRetryDelay, GUEST_DEMO_ENDPOINT, LOCAL_DEMO_ENDPOINT } from '../src/app/nexciv-preview/demoEndpoint';

describe('desktop guest service selection', () => {
  it('keeps local browser workflows on the existing local API', () => {
    expect(demoEndpoint('localhost')).toBe(LOCAL_DEMO_ENDPOINT);
    expect(demoEndpoint('127.0.0.1')).toBe(LOCAL_DEMO_ENDPOINT);
  });

  it('selects the independent guest service from any non-loopback web origin', () => {
    expect(demoEndpoint('city.example.test')).toBe(GUEST_DEMO_ENDPOINT);
    expect(demoEndpoint('localhost.example.test')).toBe(GUEST_DEMO_ENDPOINT);
  });

  it('honors a server retry delay without retrying faster than the normal poll interval', () => {
    expect(demoRetryDelay(new Response(null, { status: 429, headers: { 'Retry-After': '40' } }), 900)).toBe(40000);
    expect(demoRetryDelay(new Response(null, { status: 429, headers: { 'Retry-After': '1' } }), 2500)).toBe(2500);
    expect(demoRetryDelay(new Response(null, { status: 429 }), 900)).toBe(10000);
    expect(demoRetryDelay(new Response(null, { status: 200 }), 900)).toBe(900);
  });
});
