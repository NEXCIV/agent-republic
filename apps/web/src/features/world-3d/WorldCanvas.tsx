'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Component, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { WorldFrameV1 } from '@agent-republic/domain';
import type { ProjectStage } from '@agent-republic/world-engine';
import { toAgentMarkers } from './agents/toAgentMarkers';
import { WorldAuditEvents } from './effects/WorldAuditEvents';
import { WorldFrameStatus } from './effects/WorldFrameStatus';
import { useMilestonePulse } from './effects/useMilestonePulse';
import { useWorldFrame } from './hooks/useWorldFrame';
import { resolveSelection } from './picking/selection';
import type { WorldSelection } from './picking/selection';
import { WorldSelectionPanel } from './picking/WorldSelectionPanel';
import { pickQualityTier } from './quality';
import type { QualityTier } from './quality';
import { buildBuildingLinks, detectWebGl } from './webgl';
import { WorldPreview } from './WorldPreview';
import type { StreetView } from './AgentCenterCamera';
import type { DetailStatus } from './WorldScene';

/**
 * E6-01 — client-only WebGL gate for the district view.
 *
 * The 3D scene is loaded with `ssr: false`, probed at runtime and wrapped in an
 * error boundary. Any failure (no WebGL, lost context, renderer exception)
 * swaps in the static plan; the HTML directory below the canvas is always
 * rendered by the page and never depends on this component.
 */

const WorldScene = dynamic(() => import('./WorldScene'), {
  ssr: false,
  loading: () => (
    <StageMessage
      badge="Loading"
      title="Preparing the 3D view"
      detail="The district renderer loads only in the browser. The directory below is available immediately."
    />
  ),
});

type StageMessageProps = {
  badge: string;
  title: string;
  detail: string;
};

function StageMessage({ badge, title, detail }: StageMessageProps) {
  return (
    <div className="world-stage-message">
      <p className="badge muted">{badge}</p>
      <p className="world-stage-title">{title}</p>
      <p className="hint">{detail}</p>
    </div>
  );
}

class SceneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <StageMessage
          badge="3D view unavailable"
          title="The renderer stopped unexpectedly"
          detail="Every building and route is still listed below. Project pages, wallets and confirmed on-chain actions are unaffected."
        />
      );
    }
    return this.props.children;
  }
}

export function WorldCanvas({
  forceFallback = false,
  projectStage = null,
  initialFrame = null,
  openAgentCenter = false,
}: {
  forceFallback?: boolean;
  projectStage?: ProjectStage | null;
  initialFrame?: WorldFrameV1 | null;
  openAgentCenter?: boolean;
}) {
  // Forced text-only mode must be correct in the server-rendered HTML, before
  // any JavaScript runs; otherwise it is only a post-hydration switch.
  const [status, setStatus] = useState<'probing' | 'ready' | 'unavailable'>(
    forceFallback ? 'unavailable' : 'probing',
  );
  const [inView, setInView] = useState(true);
  const [quality, setQuality] = useState<QualityTier>('high');
  const [reducedMotion, setReducedMotion] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const liveFrame = useWorldFrame(initialFrame, !forceFallback);
  const { pulse, complete } = useMilestonePulse(liveFrame, !forceFallback);
  const [selection, setSelection] = useState<WorldSelection | null>(null);
  const [streetView, setStreetView] = useState<StreetView | null>(openAgentCenter ? 'facade' : null);
  const [detailStatus, setDetailStatus] = useState<DetailStatus>('loading');
  const buildingLinks = useMemo(() => buildBuildingLinks(), []);
  const markers = useMemo(
    () => toAgentMarkers(liveFrame?.simulation.agents ?? []),
    [liveFrame],
  );
  const resolved = selection === null ? { building: null, agent: null } : resolveSelection(selection, buildingLinks, markers);

  useEffect(() => {
    if (selection === null) return;
    const stillExists =
      selection.type === 'BUILDING'
        ? buildingLinks.some((building) => building.id === selection.id)
        : markers.some((marker) => marker.id === selection.id);
    if (!stillExists) setSelection(null);
  }, [selection, buildingLinks, markers]);

  useEffect(() => {
    if (!selection && !streetView) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setStreetView(null);
        setSelection(null);
        return;
      }
      if (streetView || event.key !== 'Enter' || selection?.type !== 'BUILDING') return;
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
      ) {
        return;
      }
      const building = buildingLinks.find((entry) => entry.id === selection.id);
      if (building?.route != null) {
        event.preventDefault();
        router.push(building.route);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, streetView, buildingLinks, router]);

  useEffect(() => {
    if (forceFallback) {
      setStatus('unavailable');
      return;
    }
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(reducedMotionQuery.matches);
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    setQuality(
      pickQualityTier({
        coarsePointer,
        hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
        deviceMemory,
        reducedMotion: reducedMotionQuery.matches,
      }),
    );
    setStatus(detectWebGl() ? 'ready' : 'unavailable');
  }, [forceFallback]);

  useEffect(() => {
    if (status !== 'ready') {
      setInView(true);
      return;
    }
    const element = stageRef.current;
    if (element === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.05 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [status]);

  let stage: ReactNode;

  if (status === 'probing') {
    stage = (
      <div className="world-stage world-stage--message">
        <StageMessage
          badge="Loading"
          title="Preparing the 3D view"
          detail="The district renderer loads only in the browser. The directory below is available immediately."
        />
      </div>
    );
  } else if (status === 'unavailable') {
    stage = (
      <div className="world-stage world-stage--fallback">
        <div className="world-fallback-copy">
          <p className="badge muted">3D view unavailable</p>
          <p className="world-stage-title">Static plan of District 01</p>
          <p className="hint">
            {forceFallback
              ? 'Text-only mode is on.'
              : 'WebGL is disabled or unsupported in this browser.'}{' '}
            Every building and route is listed below; project pages, wallets and confirmed on-chain actions keep
            working.
          </p>
        </div>
        <WorldPreview />
      </div>
    );
  } else {
    stage = (
      <>
        <div className="world-stage" ref={stageRef}>
          <SceneErrorBoundary>
            <WorldScene
              onContextLost={() => setStatus('unavailable')}
              projectStage={projectStage}
              agents={liveFrame?.simulation.agents ?? []}
              frameloop={inView ? 'demand' : 'never'}
              selectedBuildingId={selection?.type === 'BUILDING' ? selection.id : null}
              selectedAgentId={selection?.type === 'AGENT' ? selection.id : null}
              onSelectBuilding={(id) => setSelection({ type: 'BUILDING', id })}
              onSelectAgent={(id) => setSelection({ type: 'AGENT', id })}
              onClearSelection={() => setSelection(null)}
              milestoneTargetId={pulse?.targetId ?? null}
              milestoneKey={pulse?.key ?? null}
              onMilestoneComplete={complete}
              quality={quality}
              onLowPerformance={() => setQuality('low')}
              reducedMotion={reducedMotion}
              streetView={streetView}
              onDetailStatus={setDetailStatus}
            />
            <div className="world-view-controls" role="group" aria-label="World camera">
              <button type="button" onClick={() => {
                setSelection(null);
                setDetailStatus('loading');
                setStreetView(streetView ? null : 'facade');
              }}>{streetView ? 'Back to overview' : 'Agent Center street view'}</button>
              {streetView && <button type="button"
                onClick={() => setStreetView(streetView === 'facade' ? 'entrance' : 'facade')}>
                {streetView === 'facade' ? 'View entrance' : 'Whole building'}
              </button>}
            </div>
          </SceneErrorBoundary>
        </div>
        {streetView ? (
          <p className="hint world-pick-hint" role="status" data-detail={detailStatus}>
            {detailStatus === 'loading' ? 'Loading facade detail…' : detailStatus === 'fallback'
              ? 'Showing the overview model. Reopen street view to retry.'
              : 'Drag to orbit. Scroll or pinch to zoom.'}
          </p>
        ) : selection === null ? (
          <p className="hint world-pick-hint">
            Click a building or agent for details. Keyboard users can reach the same routes through the district
            directory below.
          </p>
        ) : (
          <WorldSelectionPanel
            selection={selection}
            building={resolved.building}
            agent={resolved.agent}
            onClear={() => setSelection(null)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <WorldFrameStatus frame={liveFrame} />
      {stage}
      <WorldAuditEvents frame={liveFrame} />
    </>
  );
}
