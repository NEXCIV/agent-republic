import type { NextRequest } from 'next/server';
import { forwardToApi } from '@/lib/api-proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return forwardToApi(request, '/api/v1/my-agent');
}
