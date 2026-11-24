'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DISTRICT_01 } from '@agent-republic/domain';
import type { Landmark, LandmarkId, WorldSimulation } from '@agent-republic/domain';
import type { ProjectStage } from '@agent-republic/world-engine';
import { AgentCrowd } from './agents/AgentCrowd';
import { DistrictEnvironment } from './assets/DistrictEnvironment';
import { toAgentMarkers } from './agents/toAgentMarkers';
import { useGltfAsset, useGltfScene } from './assets/useGltfScene';
import { AgentCenterCamera, type StreetView } from './AgentCenterCamera';
import { LANDMARK_BUILDINGS } from './buildings';
import { PALETTE } from './buildings/palette';
import { MilestonePulse } from './effects/MilestonePulse';
import { GroundLightEffects } from './effects/GroundLightEffects';
import type { QualityTier } from './quality';
import entranceView from './entrance-view.json';

const noop = () => {};
const { x, y, z } = entranceView.offset;
const CAMERA_OFFSET: [number, number, number] = [x, y, z];
const core = DISTRICT_01.landmarks.find((building) => building.id === 'CORE')!;
export type DetailStatus = 'loading' | 'ready' | 'fallback';

/**
 * E6-01/E6-02 — District 01 scene.
 *
 * The scene renders only static spatial facts from the scene manifest. It must
 * never derive BUILD, REP, votes or permissions: chain facts stay in the API and
 * the HTML views. Each landmark gets an original base-geometry silhouette from
 * `buildings/`; construction stages are added in E6-03.
 */

/**
 * Looking across the entry bridge keeps the plaza visible between the two
 * foreground landmarks. Focus pans without changing the viewing angle.
 */
function CameraRig({
  focus,
  reducedMotion,
}: {
  focus: readonly [number, number, number] | null;
  reducedMotion: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const baseZoom = useRef(18);
  const currentZoom = useRef(18);
  const lookAt = useRef(new THREE.Vector3(0, 0, 0));
  const desiredLook = useRef(new THREE.Vector3(0, 0, 0));
  const zoomRatio = useRef(1);
  const intro = useRef(0);
  const initialized = useRef(false);

  useEffect(() => {
    // Leave room for the bridge, cliff base and airship on tall and wide screens.
    baseZoom.current = Math.min(size.width / entranceView.minWidth, size.height / entranceView.minHeight, entranceView.maxZoom);
    if (!initialized.current) {
      // Start slightly wider so the district can ease into its published plan.
      currentZoom.current = baseZoom.current * 0.82;
      initialized.current = true;
    }
    invalidate();
  }, [size, invalidate]);

  useEffect(() => {
    if (focus === null) {
      desiredLook.current.set(0, 0, 0);
      zoomRatio.current = 1;
    } else {
      desiredLook.current.set(focus[0], focus[1], focus[2]);
      zoomRatio.current = 1.45;
    }
    invalidate();
  }, [focus, invalidate]);

  useFrame((_, delta) => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    const blend = reducedMotion ? 1 : Math.min(1, Math.max(0.06, delta * 5));
    intro.current = reducedMotion ? 1 : Math.min(1, intro.current + delta / 1.2);
    const introEase = 1 - Math.pow(1 - intro.current, 3);
    const targetZoom = baseZoom.current * zoomRatio.current * (0.82 + 0.18 * introEase);

    lookAt.current.lerp(desiredLook.current, blend);
    currentZoom.current += (targetZoom - currentZoom.current) * blend;

    camera.position.set(...CAMERA_OFFSET).add(lookAt.current);
    camera.lookAt(lookAt.current);
    camera.zoom = currentZoom.current;
    camera.updateProjectionMatrix();

    const unsettled =
      intro.current < 1 ||
      Math.abs(targetZoom - currentZoom.current) > 0.01 ||
      lookAt.current.distanceTo(desiredLook.current) > 0.02;
    if (unsettled) invalidate();
  });

  return null;
}

/**
 * A local studio environment gives the metallic PBR materials something to
 * reflect. Without it metalness renders almost black on a dark page.
 */
function StudioEnvironment() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const previousExposure = gl.toneMappingExposure;
    const previousEnvironmentIntensity = scene.environmentIntensity;
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.34;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 0.96;
    room.dispose();
    invalidate();

    return () => {
      scene.environment = null;
      scene.environmentIntensity = previousEnvironmentIntensity;
      gl.toneMappingExposure = previousExposure;
      target.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);

  return null;
}

function SelectionOutline({ landmark }: { landmark: Landmark }) {
  const [width, height, depth] = landmark.bounds;
  const radius = Math.max(width, depth) / 2 + 0.6;
  const shellHeight = Math.max(height, 1);

  return (
    <group>
      <mesh position={[0, shellHeight / 2, 0]}>
        <boxGeometry args={[width + 0.5, shellHeight + 0.3, depth + 0.5]} />
        <meshBasicMaterial
          color={PALETTE.gold}
          wireframe
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius, radius + 0.35, 48]} />
        <meshBasicMaterial
          color={PALETTE.gold}
          transparent
          opacity={0.7}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/**
 * E6-07 — degrade once when the actively rendered scene stays below 24 FPS.
 * The demand loop means idle frames never accumulate here.
 */
function FrameBudget({
  enabled,
  onSlow,
}: {
  enabled: boolean;
  onSlow?: () => void;
}) {
  const frames = useRef(0);
  const elapsed = useRef(0);
  const fired = useRef(false);

  useFrame((_, delta) => {
    if (!enabled || fired.current || onSlow === undefined) return;
    frames.current += 1;
    elapsed.current += delta;
    if (frames.current < 120) return;

    const fps = frames.current / elapsed.current;
    frames.current = 0;
    elapsed.current = 0;
    if (fps < 24) {
      fired.current = true;
      onSlow();
    }
  });

  return null;
}

/**
 * Cheap procedural contact shadow: one 128px radial texture shared by every
 * landmark. No shadow maps, no extra lights, five draw calls.
 */
function createShadowTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(23, 24, 21, 0.28)');
  gradient.addColorStop(0.55, 'rgba(23, 24, 21, 0.12)');
  gradient.addColorStop(1, 'rgba(23, 24, 21, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function ContactShadow({
  landmark,
  texture,
}: {
  landmark: Landmark;
  texture: THREE.CanvasTexture;
}) {
  const size = Math.max(landmark.bounds[0], landmark.bounds[2]) * 1.05;

  return (
    <mesh
      position={[landmark.position[0], landmark.position[1] + 0.008, landmark.position[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={texture} transparent opacity={0.55} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function FacadeLight({ model, highQuality }: { model: THREE.Group | null; highQuality: boolean }) {
  const renderer = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const target = useMemo(() => new THREE.Object3D(), []);
  target.position.set(0, 2, 0);
  useEffect(() => {
    if (!model || !highQuality) return;
    // The building and sun are static. Refresh the shadow map only on a model swap.
    const shadows = renderer.shadowMap;
    const { enabled, autoUpdate } = shadows;
    shadows.enabled = true;
    shadows.autoUpdate = false;
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = object.receiveShadow = true;
    });
    shadows.needsUpdate = true;
    invalidate();
    return () => {
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) object.castShadow = object.receiveShadow = false;
      });
      shadows.enabled = enabled;
      shadows.autoUpdate = autoUpdate;
      invalidate();
    };
  }, [model, highQuality, renderer, invalidate]);
  return (
    <>
      <primitive object={target} />
      <directionalLight target={target} position={[7, 12, 5]} intensity={1.65} color="#fff2df"
        castShadow={highQuality} shadow-mapSize-width={1024} shadow-mapSize-height={1024}
        shadow-camera-left={-5.5} shadow-camera-right={5.5} shadow-camera-bottom={-5.5}
        shadow-camera-top={5.5} shadow-camera-near={0.5} shadow-camera-far={28}
        shadow-normalBias={0.012} shadow-bias={-0.0002} />
      {highQuality && <mesh receiveShadow position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[14, 14]} />
        <shadowMaterial transparent opacity={0.27} depthWrite={false} />
      </mesh>}
    </>
  );
}

/** The four standalone landmarks each have a GLB; the plaza lives in the island GLB. */
const LANDMARK_MODEL_URLS: Partial<Record<LandmarkId, string>> = {
  COUNCIL: '/world/district-01/v1/council.glb',
  IDENTITY: '/world/district-01/v1/identity.glb',
  PROJECT: '/world/district-01/v1/project.glb',
  CORE: '/world/district-01/v1/agent-center-overview.glb',
};

const PROJECT_STAGE_KEYS: Record<ProjectStage, string> = {
  FOUNDATION: 'stage_foundation',
  FRAME: 'stage_frame',
  FACADE: 'stage_facade',
  COMPLETE: 'stage_complete',
};

/** Toggles the four named stage groups; a reload shows the final pose. */
function applyProjectStage(scene: THREE.Group, stage: ProjectStage | null) {
  const visibleKey = stage === null ? 'stage_foundation' : PROJECT_STAGE_KEYS[stage];
  scene.traverse((node) => {
    if (node.name.startsWith('stage_')) node.visible = node.name === visibleKey;
  });
}

function LandmarkGlb({
  scene,
  landmark,
  stage,
}: {
  scene: THREE.Group;
  landmark: Landmark;
  stage: ProjectStage | null;
}) {
  useMemo(() => {
    if (landmark.id === 'PROJECT') applyProjectStage(scene, stage);
  }, [scene, landmark.id, stage]);
  return <primitive object={scene} />;
}

function LandmarkModel({
  landmark,
  stage,
  selected,
  renderedInEnvironment,
  onSelect,
  streetQuality,
  onDetailStatus,
}: {
  landmark: Landmark;
  stage: ProjectStage | null;
  selected: boolean;
  renderedInEnvironment: boolean;
  onSelect?: (id: LandmarkId) => void;
  streetQuality?: QualityTier;
  onDetailStatus?: (status: DetailStatus) => void;
}) {
  const Model = LANDMARK_BUILDINGS[landmark.id];
  const [x, y, z] = landmark.position;
  const overview = useGltfScene(LANDMARK_MODEL_URLS[landmark.id] ?? null);
  const textureLimit = useThree((state) => state.gl.capabilities.maxTextureSize);
  const detailUrl = streetQuality && textureLimit >= 2048
    ? '/world/district-01/v1/agent-center-' + (streetQuality === 'high' && textureLimit >= 4096 ? 'detail' : 'mobile') + '.glb'
    : null;
  const detail = useGltfAsset(detailUrl);
  const glb = detail?.scene ?? overview;
  useEffect(() => {
    if (streetQuality) onDetailStatus?.(!detailUrl ? 'fallback' : !detail ? 'loading' : detail.scene ? 'ready' : 'fallback');
  }, [streetQuality, detailUrl, detail, onDetailStatus]);

  return (
    <group
      position={[x, y, z]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(landmark.id);
      }}
    >
      {!renderedInEnvironment && (glb === null ? (
        <Model bounds={landmark.bounds} stage={stage} />
      ) : (
        <LandmarkGlb scene={glb} landmark={landmark} stage={stage} />
      ))}
      {selected ? <SelectionOutline landmark={landmark} /> : null}
      {streetQuality && <FacadeLight model={glb} highQuality={streetQuality === 'high'} />}
    </group>
  );
}

function Ground({ onClear }: { onClear?: () => void }) {
  const { width, depth, y } = DISTRICT_01.ground;

  return (
    <group
      position={[0, y, 0]}
      onClick={(event) => {
        if (onClear === undefined) return;
        event.stopPropagation();
        onClear();
      }}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={PALETTE.ground} metalness={0.1} roughness={0.95} />
      </mesh>
      <gridHelper args={[width, width, '#2b3a37', '#16211f']} position={[0, 0.005, 0]} />
    </group>
  );
}

export type WorldSceneProps = {
  streetView?: StreetView | null;
  onDetailStatus?: (status: DetailStatus) => void;
  /** Called when the GPU drops the WebGL context; the page falls back to HTML. */
  onContextLost?: () => void;
  /** Confirmed construction stage for project #1; null means no confirmed data. */
  projectStage?: ProjectStage | null;
  /** Simulation agents from WorldFrameV1; invalid points are dropped by the adapter. */
  agents?: WorldSimulation['agents'];
  /** 'never' pauses the render loop while the canvas is offscreen. */
  frameloop?: 'demand' | 'never';
  selectedBuildingId?: LandmarkId | null;
  selectedAgentId?: string | null;
  onSelectBuilding?: (id: LandmarkId) => void;
  onSelectAgent?: (id: string) => void;
  onClearSelection?: () => void;
  milestoneTargetId?: LandmarkId | null;
  milestoneKey?: string | null;
  onMilestoneComplete?: () => void;
  quality?: QualityTier;
  /** Called once if the actively rendered scene stays below 24 FPS. */
  onLowPerformance?: () => void;
  /** Camera focus snaps instead of animating when motion is reduced. */
  reducedMotion?: boolean;
};

export default function WorldScene({
  streetView = null,
  onDetailStatus,
  onContextLost,
  projectStage = null,
  agents = [],
  frameloop = 'demand',
  selectedBuildingId = null,
  selectedAgentId = null,
  onSelectBuilding,
  onSelectAgent,
  onClearSelection,
  milestoneTargetId = null,
  milestoneKey = null,
  onMilestoneComplete = noop,
  quality = 'high',
  onLowPerformance,
  reducedMotion = false,
}: WorldSceneProps) {
  const environment = useGltfScene('/world/district-01/v1/environment.glb');
  const plaza = useMemo(() => environment?.getObjectByName('CivicPlaza'), [environment]);
  const markers = useMemo(() => toAgentMarkers(agents), [agents]);
  const focus = useMemo<readonly [number, number, number] | null>(() => {
    if (selectedBuildingId === null) return null;
    const landmark = DISTRICT_01.landmarks.find((entry) => entry.id === selectedBuildingId);
    if (landmark === undefined) return null;
    return [landmark.position[0], landmark.bounds[1] * 0.35, landmark.position[2]];
  }, [selectedBuildingId]);
  const milestoneLandmark = useMemo(() => {
    if (milestoneTargetId === null) return undefined;
    return DISTRICT_01.landmarks.find((entry) => entry.id === milestoneTargetId);
  }, [milestoneTargetId]);
  const shadowTexture = useMemo(() => createShadowTexture(), []);
  useEffect(() => () => shadowTexture?.dispose(), [shadowTexture]);

  return (
    <Canvas
      orthographic
      style={{ background: 'linear-gradient(180deg, #82adc9, #c1dce2 75%, #d4e5df)' }}
      frameloop={frameloop}
      dpr={quality === 'low' ? 1 : [1, 2]}
      gl={{ antialias: quality === 'high', powerPreference: 'high-performance' }}
      camera={{ position: CAMERA_OFFSET, zoom: 18, near: 0.1, far: 200 }}
      onPointerMissed={streetView ? undefined : onClearSelection}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener(
          'webglcontextlost',
          (event) => {
            event.preventDefault();
            onContextLost?.();
          },
          { once: true },
        );
      }}
    >
      <StudioEnvironment />
      <hemisphereLight args={['#d8eeff', '#b8aa91', streetView ? 0.95 : 1.15]} />
      {!streetView && <directionalLight position={[-16, 32, 23]} intensity={2.1} color="#fff1d9" />}
      <directionalLight position={[21, 14, -16]} intensity={0.48} color="#c7e7ff" />
      {streetView
        ? <AgentCenterCamera view={streetView} position={core.position} />
        : <CameraRig focus={focus} reducedMotion={reducedMotion} />}
      <FrameBudget enabled={quality === 'high'} onSlow={onLowPerformance} />
      {plaza === undefined && <Ground onClear={streetView ? undefined : onClearSelection} />}
      {environment && (
        <DistrictEnvironment
          scene={environment}
          plaza={plaza}
          onClear={streetView ? undefined : onClearSelection}
          onSelectPlaza={() => { if (!streetView) onSelectBuilding?.('PLAZA'); }}
          reducedMotion={reducedMotion}
        />
      )}
      {plaza === undefined && <GroundLightEffects enabled={quality === 'high'} />}
      {shadowTexture === null
        ? null
        : DISTRICT_01.landmarks.map((landmark) => (
            <ContactShadow key={`shadow-${landmark.id}`} landmark={landmark} texture={shadowTexture} />
          ))}
      {DISTRICT_01.landmarks.map((landmark) => (
        <LandmarkModel
          key={landmark.id}
          landmark={landmark}
          stage={projectStage}
          selected={!streetView && selectedBuildingId === landmark.id}
          streetQuality={streetView && landmark.id === 'CORE' ? quality : undefined}
          onDetailStatus={onDetailStatus}
          renderedInEnvironment={plaza !== undefined && landmark.id === 'PLAZA'}
          onSelect={streetView ? undefined : onSelectBuilding}
        />
      ))}
      <AgentCrowd
        markers={markers}
        selectedId={selectedAgentId}
        onSelect={streetView ? undefined : onSelectAgent}
      />
      {milestoneLandmark !== undefined && milestoneKey !== null ? (
        <MilestonePulse
          key={milestoneKey}
          landmark={milestoneLandmark}
          onComplete={onMilestoneComplete}
        />
      ) : null}
    </Canvas>
  );
}
