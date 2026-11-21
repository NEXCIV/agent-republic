'use client';

import { useGltfScene } from '../assets/useGltfScene';
import { ConeCrowd } from './ConeCrowd';
import { CitizenCrowd } from './CitizenCrowd';
import type { AgentMarker } from './toAgentMarkers';

/**
 * P0+ — renders low-poly citizens once agent-citizen.glb is available and
 * falls back to the original cone markers otherwise, so the crowd is never
 * blocked on the network (design doc §5).
 */
const MODEL_URL = '/world/district-01/v1/agent-citizen.glb';

export function AgentCrowd(props: {
  markers: AgentMarker[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const glb = useGltfScene(MODEL_URL);
  if (glb === null) return <ConeCrowd {...props} />;
  return <CitizenCrowd {...props} scene={glb} />;
}
