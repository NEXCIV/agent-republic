import type { WorldFrameV1 } from '@agent-republic/domain';
import type {
  ActivityItem,
  Envelope,
  ProposalDetail,
  ProposalListItem,
  ProjectDetail,
  ProjectListItem,
  TxStatusBody,
} from './types';

/**
 * Server-side API client.
 *
 * The web app never fabricates chain data: if the API is unreachable the
 * pages render an explicit "data unavailable" state instead of placeholders
 * that could be mistaken for real on-chain numbers.
 */

const API_BASE = (process.env.API_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');

export type FetchResult<T> =
  | { ok: true; body: T }
  | { ok: false; reason: 'NOT_FOUND' | 'UNAVAILABLE' };

async function request<T>(path: string): Promise<FetchResult<T>> {
  try {
    const response = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
    if (response.status === 404) return { ok: false, reason: 'NOT_FOUND' };
    if (!response.ok) return { ok: false, reason: 'UNAVAILABLE' };
    return { ok: true, body: (await response.json()) as T };
  } catch {
    return { ok: false, reason: 'UNAVAILABLE' };
  }
}

export const getProposals = (status?: string) =>
  request<Envelope<ProposalListItem[]>>(
    status === undefined ? '/api/v1/proposals' : `/api/v1/proposals?status=${status}`,
  );

export const getProposal = (id: string) => request<Envelope<ProposalDetail>>(`/api/v1/proposals/${id}`);

export const getProjects = () => request<Envelope<ProjectListItem[]>>('/api/v1/projects');

export const getProject = (id: string) => request<Envelope<ProjectDetail>>(`/api/v1/projects/${id}`);

export const getActivity = (limit = 50) =>
  request<Envelope<ActivityItem[]>>(`/api/v1/activity?limit=${limit}`);

export const getTxStatus = (hash: string) => request<TxStatusBody>(`/api/v1/tx/${hash}`);

/** E6-04 — read-only world frame (validated by the caller before use). */
export const getWorldFrame = () => request<WorldFrameV1>('/api/v1/world/frame');
