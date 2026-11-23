'use client';

import Link from 'next/link';
import type { AgentMarker } from '../agents/toAgentMarkers';
import type { WorldSelection } from './selection';
import type { WorldBuildingLink } from '../webgl';
import { commandLink } from '../../agent-commands/world-command';

/**
 * E6-05 — semantic details for a picked object. All text that matters is in
 * HTML; clicking a model never submits a transaction. Touch targets are at
 * least 44 CSS px high.
 */
export function WorldSelectionPanel({
  selection,
  building,
  agent,
  onClear,
}: {
  selection: WorldSelection;
  building: WorldBuildingLink | null;
  agent: AgentMarker | null;
  onClear: () => void;
}) {
  if (selection.type === 'BUILDING' && building !== null) {
    return (
      <section className="world-selection" aria-live="polite">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <p className="badge muted">Building selected</p>
            <p className="world-stage-title">{building.label}</p>
            <p className="hint">
              {building.id} · x {building.position[0]} · z {building.position[2]} · footprint{' '}
              {building.bounds[0]}×{building.bounds[2]} m
            </p>
          </div>
          {building.route === null ? (
            <span className="badge muted">Public space</span>
          ) : (
            <Link className="world-open-link" href={building.route} prefetch={false}>
              Open {building.route}
            </Link>
          )}
        </div>
        <Link href={commandLink('visit', building.id)} prefetch={false}>Draft a visit command</Link>
        <p className="hint" style={{ marginBottom: 0 }}>
          <button type="button" onClick={onClear}>
            Clear selection (Esc)
          </button>{' '}
          {building.route === null ? '' : '· Enter opens the same route.'}
        </p>
      </section>
    );
  }

  if (selection.type === 'AGENT' && agent !== null) {
    return (
      <section className="world-selection" aria-live="polite">
        <p className="badge muted">AI SIMULATED</p>
        <p className="world-stage-title">{agent.id}</p>
        <p className="hint">
          {agent.action} · {agent.locationId} · x {agent.position[0].toFixed(1)} · z{' '}
          {agent.position[2].toFixed(1)}
        </p>
        <p className="hint">
          Simulated presentation only. No verified Agent ID binding is displayed for this marker, and its position
          never proves an on-chain fact.
        </p>
        <Link href={commandLink('meet', agent.id)} prefetch={false}>Draft a conversation command</Link>{' '}
        <button type="button" onClick={onClear}>
          Clear selection (Esc)
        </button>
      </section>
    );
  }

  return null;
}
