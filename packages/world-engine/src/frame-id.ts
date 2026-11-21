import { createHash } from 'node:crypto';
import type { WorldFrameV1 } from '@agent-republic/domain';

/**
 * E5-01 frame identity (docs/WORLD_ENGINE.md §2.1).
 *
 * frameId = sha256(canonicalize(frame minus frameId and generatedAt))
 * canonicalize: recursive key sort, arrays keep order, UTF-8, no whitespace.
 * Same confirmed facts + same tick must produce the same id on every replay.
 */

export class FrameCanonicalizationError extends Error {
  constructor(message: string) {
    super(`[world-frame] ${message}`);
    this.name = 'FrameCanonicalizationError';
  }
}

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new FrameCanonicalizationError('frame contains a non-finite number');
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new FrameCanonicalizationError(`unsupported value type "${typeof value}" in frame`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`;
}

/** Parts of a frame that must not influence its identity hash. */
const VOLATILE_FIELDS = new Set(['frameId', 'generatedAt']);

export function computeFrameId(frame: Omit<WorldFrameV1, 'frameId'> & { frameId?: string }): string {
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frame)) {
    if (!VOLATILE_FIELDS.has(key)) content[key] = value;
  }
  const digest = createHash('sha256').update(canonicalize(content), 'utf8').digest('hex');
  return `0x${digest}`;
}

/** Returns the frame with its identity filled in. */
export function withFrameId(frame: Omit<WorldFrameV1, 'frameId'> & { frameId?: string }): WorldFrameV1 {
  return { ...frame, frameId: computeFrameId(frame) } as WorldFrameV1;
}
