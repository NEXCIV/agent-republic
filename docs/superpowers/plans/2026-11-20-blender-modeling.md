# Blender 建模管线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 bpy 脚本生成低多边形 GLB 资产（小人市民、四栋建筑含马桶大厦 4 阶段、环境精装），接入 three.js 并保留程序化几何作 fallback。

**Architecture:** Blender 无头脚本产出 GLB 到 `apps/web/public/world/district-01/v1/`；渲染端新增共享 `useGltfScene` hook，GLB 未就绪/失败时回退现有程序化组件；AgentCrowd 拆为 ConeCrowd（fallback）+ CitizenCrowd（每部件一个 InstancedMesh，程序化摆腿）。

**Tech Stack:** Blender 5.3（`G:\blender\blender.exe`，bpy 无头）、three.js GLTFLoader、R3F、pnpm monorepo。

**设计文档:** `docs/superpowers/specs/2026-11-20-blender-modeling-design.md`（已批准）

**注意:** 仓库当前未初始化 git。每个 Task 以「验证命令通过」为检查点；若 git 已初始化，Task 结束执行 `git add -A; git commit -m "<task 名>"`。

**命令前缀（PowerShell 5，全部在 `项目根目录` 下执行）:**

```powershell
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT="0"
```

---

## 批次 1：小人市民 + AgentCrowd 改造

### Task 1: bpy 小人建模脚本

**Files:**
- Create: `tools/blender/build_agent_citizen.py`
- 产出: `apps/web/public/world/district-01/v1/agent-citizen.glb`、`tools/blender/blends/agent-citizen.blend`

- [ ] **Step 1: 写脚本**

```python
"""Build agent-citizen.glb — low-poly citizen with named, rig-ready parts.

Style: low-poly stylized, flat shaded. Part origins are animation pivots:
legs at the hips, arms at the shoulders, body/head on the root axis.
Part names (body/head/armL/armR/legL/legR) match the future Armature
upgrade path in the approved design doc.

Run (PowerShell, repo root):
  & "G:\\blender\\blender.exe" --background --factory-startup --python tools\\blender\\build_agent_citizen.py
"""
import bpy
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "apps" / "web" / "public" / "world" / "district-01" / "v1"
BLEND_DIR = ROOT / "tools" / "blends"
OUT = OUT_DIR / "agent-citizen.glb"

# Colours aligned with apps/web/src/features/world-3d/buildings/palette.ts
# and UI_DESIGN.md accents. Blender is Z-up; glTF export converts to Y-up.
GRAPHITE = (0.290, 0.294, 0.267, 1.0)  # palette.graphite #4a4b44
DARK = (0.165, 0.169, 0.149, 1.0)      # palette.dark     #2a2b26
TEAL = (0.318, 0.722, 0.655, 1.0)      # UI accent        #51B8A7


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def make_mat(name, rgba, metallic=0.35, roughness=0.6, emission=None, strength=1.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = strength
    return material


def add_box(name, dims, loc, material, parent):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def add_cyl(name, radius, depth, loc, material, parent, verts=12):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, location=loc, vertices=verts
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def add_sphere(name, radius, loc, material, parent, subs=2):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=loc, subdivisions=subs)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def set_origin_at(obj, point):
    """Move the object origin to `point` (animation pivot) keeping the mesh."""
    bpy.context.scene.cursor.location = point
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")


def build_citizen():
    clear_scene()
    root = bpy.data.objects.new("AgentCitizen", None)
    bpy.context.scene.collection.objects.link(root)

    body_mat = make_mat("citizen_body", GRAPHITE, metallic=0.3, roughness=0.55)
    head_mat = make_mat("citizen_head", DARK, metallic=0.4, roughness=0.5)
    limb_mat = make_mat("citizen_limb", DARK, metallic=0.35, roughness=0.6)
    visor_mat = make_mat("citizen_visor", TEAL, emission=TEAL, strength=1.4)

    # Torso: from 0.72 to 1.30 (origin at the root axis, feet level).
    body = add_box("body", (0.36, 0.24, 0.58), (0, 0, 1.01), body_mat, root)
    # Chest badge keeps the civic gold accent readable at crowd scale.
    badge = add_box("badge", (0.10, 0.03, 0.07), (0.09, -0.13, 1.16), visor_mat, root)
    # Head with visor; origin at the root axis.
    head = add_sphere("head", 0.17, (0, 0, 1.47), head_mat, root, subs=2)
    visor = add_box("visor", (0.22, 0.06, 0.08), (0, -0.15, 1.49), visor_mat, root)

    # Legs: cylinders from 0.78 down to 0.02, origin at the hip pivot.
    for side, x in (("legL", -0.095), ("legR", 0.095)):
        leg = add_cyl(side, 0.075, 0.76, (x, 0, 0.40), limb_mat, root, verts=10)
        set_origin_at(leg, (x, 0, 0.78))

    # Arms: cylinders from the shoulders down, origin at the shoulder pivot.
    for side, x in (("armL", -0.235), ("armR", 0.235)):
        arm = add_cyl(side, 0.055, 0.50, (x, 0, 1.02), limb_mat, root, verts=8)
        set_origin_at(arm, (x, 0, 1.27))

    return [body, badge, head, visor]


def export(objects):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    BLEND_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        if obj.name == "AgentCitizen" or obj.parent is not None:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUT), export_format="GLB", use_selection=True, export_apply=True
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / "agent-citizen.blend"))
    tris = sum(len(obj.data.polygons) for obj in objects if obj.type == "MESH")
    parts = sorted(
        obj.name for obj in bpy.data.objects
        if obj.type == "MESH" and obj.parent is not None
    )
    print("AGENT_CITIZEN_RESULT " + json.dumps({
        "file": str(OUT), "bytes": OUT.stat().st_size, "tris": tris, "parts": parts,
    }))


build_citizen()
export(bpy.data.objects)
sys.exit(0)
```

- [ ] **Step 2: 运行脚本**

```powershell
& "G:\blender\blender.exe" --background --factory-startup --python "tools\blender\build_agent_citizen.py"
```

Expected: stdout 末行 `AGENT_CITIZEN_RESULT {"file": ...agent-citizen.glb", "bytes": <8k-40k>, "tris": <300-800>, "parts": [...]}`，parts 包含 `armL/armR/badge/body/head/legL/legR/visor`。若 tris 超预算，把 head `subs=2` 降为 `subs=1` 或腿 `verts=10` 降为 `8`。

### Task 2: 共享 GLB 加载 hook

**Files:**
- Create: `apps/web/src/features/world-3d/assets/useGltfScene.ts`

- [ ] **Step 1: 写文件**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Group } from 'three';

const cache = new Map<string, Promise<Group>>();
let loader: GLTFLoader | null = null;

function load(url: string): Promise<Group> {
  let pending = cache.get(url);
  if (pending === undefined) {
    if (loader === null) loader = new GLTFLoader();
    pending = loader.loadAsync(url).then((gltf) => gltf.scene);
    cache.set(url, pending);
  }
  return pending;
}

/**
 * P0+ — loads a GLB scene once per URL. Returns null while loading and after
 * a failure; callers keep their procedural fallback in that case, so a missing
 * asset can never blank or block the world (docs/3D_RENDERING.md §9).
 */
export function useGltfScene(url: string | null): Group | null {
  const [scene, setScene] = useState<Group | null>(null);

  useEffect(() => {
    if (url === null) return;
    let alive = true;
    load(url)
      .then((loaded) => {
        if (alive) setScene(loaded.clone(true));
      })
      .catch(() => {
        // Keep the procedural fallback; do not retry per render.
      });
    return () => {
      alive = false;
    };
  }, [url]);

  return scene;
}
```

- [ ] **Step 2: 验证类型**

```powershell
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT="0"
pnpm --filter @agent-republic/web typecheck
```

Expected: exit 0。

### Task 3: AgentCrowd 拆分（Cone fallback + Citizen 主路径）

**Files:**
- Create: `apps/web/src/features/world-3d/agents/ConeCrowd.tsx`（现有 AgentCrowd.tsx 内容原样搬移）
- Create: `apps/web/src/features/world-3d/agents/CitizenCrowd.tsx`
- Modify: `apps/web/src/features/world-3d/agents/AgentCrowd.tsx`（改为切换器）

- [ ] **Step 1: 搬移 fallback**

复制 `agents/AgentCrowd.tsx` 全部内容到 `agents/ConeCrowd.tsx`，仅两处改动：导出名 `AgentCrowd` → `ConeCrowd`；文件头注释补一行 `Fallback while agent-citizen.glb is unavailable.`。其余逻辑（markers effect、useFrame、ring/pick）逐字保留。

- [ ] **Step 2: 写 CitizenCrowd.tsx**

```typescript
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { MAX_VISIBLE_AGENTS } from '@agent-republic/domain';
import { useGltfScene } from '../assets/useGltfScene';
import type { AgentMarker } from './toAgentMarkers';
import { shouldSnapAgent, stepAgentPosition } from './motion';

/**
 * P0+ — instanced low-poly citizens built from agent-citizen.glb.
 *
 * One InstancedMesh per body part keeps the whole crowd at about eight draw
 * calls. Body and head are tinted per instance; limbs stay graphite. Legs and
 * arms swing procedurally around the pivots baked into the GLB origins, and
 * the naming matches a future Armature upgrade (design doc §9). This
 * component still only renders validated markers and lerps locally at a
 * capped speed — it never computes world rules.
 */

const MODEL_URL = '/world/district-01/v1/agent-citizen.glb';
const PART_NAMES = ['body', 'head', 'armL', 'armR', 'legL', 'legR'] as const;
type PartName = (typeof PART_NAMES)[number];

/** Leg swing amplitude (radians) and stride frequency while moving. */
const SWING_AMPLITUDE = 0.55;
const STRIDE_HERTZ = 2.4;
/** Idle breathing bob amplitude in metres. */
const IDLE_BOB = 0.02;

type PartGeometry = { geometry: THREE.BufferGeometry; offset: THREE.Vector3 };

function extractParts(scene: THREE.Group): Partial<Record<PartName, PartGeometry>> {
  const parts: Partial<Record<PartName, PartGeometry>> = {};
  for (const name of PART_NAMES) {
    const node = scene.getObjectByName(name);
    if (node instanceof THREE.Mesh) {
      parts[name] = { geometry: node.geometry, offset: node.position.clone() };
    }
  }
  return parts;
}

export function CitizenCrowd({
  markers,
  selectedId = null,
  onSelect,
}: {
  markers: AgentMarker[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const glb = useGltfScene(MODEL_URL);
  const parts = useMemo(() => (glb === null ? null : extractParts(glb)), [glb]);
  const partRefs = useRef<Partial<Record<PartName, THREE.InstancedMesh | null>>>({});
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const pickRef = useRef<THREE.InstancedMesh>(null);
  const positionsRef = useRef(new Map<string, [number, number, number]>());
  const targetsRef = useRef(new Map<string, [number, number, number]>());
  const phaseRef = useRef(new Map<string, number>());
  const [reduced, setReduced] = useState(false);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colour = useMemo(() => new THREE.Color(), []);
  const offset = useMemo(() => new THREE.Vector3(), []);
  const invalidate = useThree((state) => state.invalidate);
  const clock = useThree((state) => state.clock);

  const limbMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#4a4b44', metalness: 0.35, roughness: 0.6 }),
    [],
  );
  const tintMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.25, roughness: 0.55 }),
    [],
  );
  useEffect(
    () => () => {
      limbMaterial.dispose();
      tintMaterial.dispose();
    },
    [limbMaterial, tintMaterial],
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  /** Rotates a part pivot offset into world space for the given facing. */
  const writePart = (
    name: PartName,
    index: number,
    position: readonly [number, number, number],
    facing: number,
    scale: number,
    swing: number,
    bobY: number,
  ) => {
    const mesh = partRefs.current[name];
    const part = parts?.[name];
    if (mesh === null || mesh === undefined || part === undefined) return;

    const c = Math.cos(facing);
    const s = Math.sin(facing);
    offset.copy(part.offset);
    dummy.position.set(
      position[0] + offset.x * c + offset.z * s,
      position[1] + offset.y + bobY,
      position[2] - offset.x * s + offset.z * c,
    );
    dummy.rotation.set(0, facing, 0);
    dummy.scale.setScalar(scale);
    if (name === 'legL') dummy.rotateX(swing);
    else if (name === 'legR') dummy.rotateX(-swing);
    else if (name === 'armL') dummy.rotateX(-swing * 0.7);
    else if (name === 'armR') dummy.rotateX(swing * 0.7);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  };

  useEffect(() => {
    const ring = ringRef.current;
    const pick = pickRef.current;
    if (ring === null || pick === null) return;

    const targets = new Map<string, [number, number, number]>();
    markers.forEach((marker) => targets.set(marker.id, [...marker.position]));
    targetsRef.current = targets;
    for (const id of [...positionsRef.current.keys()]) {
      if (!targets.has(id)) {
        positionsRef.current.delete(id);
        phaseRef.current.delete(id);
      }
    }
    // First appearance, reduced motion or a new frame after a long pause:
    // load the final pose instead of replaying every old step.
    markers.forEach((marker) => {
      if (reduced || !positionsRef.current.has(marker.id)) {
        positionsRef.current.set(marker.id, [...marker.position]);
      }
    });

    const count = markers.length;
    PART_NAMES.forEach((name) => {
      const mesh = partRefs.current[name];
      if (mesh !== null && mesh !== undefined) mesh.count = count;
    });
    ring.count = count;
    pick.count = count;

    markers.forEach((marker, index) => {
      const highlight = marker.id === selectedId;
      const position = positionsRef.current.get(marker.id) ?? marker.position;
      const tinted = partRefs.current.body;
      if (tinted !== null && tinted !== undefined) {
        tinted.setColorAt(index, colour.set(marker.color));
      }
      const tintedHead = partRefs.current.head;
      if (tintedHead !== null && tintedHead !== undefined) {
        tintedHead.setColorAt(index, colour.set(marker.color));
      }
      const scale = highlight ? 1.35 : 1;
      PART_NAMES.forEach((name) =>
        writePart(name, index, position, marker.facingRadians, scale, 0, 0),
      );

      dummy.position.set(position[0], position[1] + 0.015, position[2]);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(highlight ? 1.2 : 1);
      dummy.updateMatrix();
      ring.setMatrixAt(index, dummy.matrix);

      // Generous invisible hit volume so touch picking is not limited to the
      // few pixels of the citizen silhouette.
      dummy.position.set(position[0], position[1] + 0.8, position[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      pick.setMatrixAt(index, dummy.matrix);
    });

    PART_NAMES.forEach((name) => {
      const mesh = partRefs.current[name];
      if (mesh !== null && mesh !== undefined) mesh.instanceMatrix.needsUpdate = true;
      if (mesh !== null && mesh !== undefined && mesh.instanceColor !== null) {
        mesh.instanceColor.needsUpdate = true;
      }
    });
    ring.instanceMatrix.needsUpdate = true;
    pick.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [markers, selectedId, reduced, parts, writePart, dummy, colour, offset, invalidate]);

  useFrame((_, delta) => {
    const ring = ringRef.current;
    const pick = pickRef.current;
    if (ring === null || pick === null || markers.length === 0) return;

    let moving = false;
    const now = clock.elapsedTime;
    markers.forEach((marker, index) => {
      const current = positionsRef.current.get(marker.id) ?? marker.position;
      const target = targetsRef.current.get(marker.id) ?? marker.position;
      const next = reduced
        ? target
        : shouldSnapAgent(current, target)
          ? target
          : stepAgentPosition(current, target, delta);

      if (next !== current) {
        positionsRef.current.set(marker.id, [...next]);
        moving = true;
      }

      const arrived = next === target;
      const phase = phaseRef.current.get(marker.id) ?? 0;
      const advanced = arrived ? phase : phase + delta * STRIDE_HERTZ * Math.PI * 2;
      phaseRef.current.set(marker.id, advanced);

      // Swing decays to zero when idle; bob keeps a subtle idle breath.
      const swing = arrived ? 0 : Math.sin(advanced) * SWING_AMPLITUDE;
      let bob = 0;
      if (arrived && !reduced) {
        let hash = 0;
        for (let i = 0; i < marker.id.length; i += 1) hash = (hash * 31 + marker.id.charCodeAt(i)) >>> 0;
        bob = Math.sin(now * 1.6 + hash) * IDLE_BOB;
      }

      const highlight = marker.id === selectedId;
      const scale = highlight ? 1.35 : 1;
      PART_NAMES.forEach((name) =>
        writePart(name, index, next, marker.facingRadians, scale, swing, bob),
      );

      dummy.position.set(next[0], next[1] + 0.015, next[2]);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(highlight ? 1.2 : 1);
      dummy.updateMatrix();
      ring.setMatrixAt(index, dummy.matrix);

      dummy.position.set(next[0], next[1] + 0.8, next[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      pick.setMatrixAt(index, dummy.matrix);
    });

    PART_NAMES.forEach((name) => {
      const mesh = partRefs.current[name];
      if (mesh !== null && mesh !== undefined) mesh.instanceMatrix.needsUpdate = true;
    });
    ring.instanceMatrix.needsUpdate = true;
    pick.instanceMatrix.needsUpdate = true;
    // Invalidate only while someone is moving: the demand render loop must
    // go fully idle when the crowd settles (docs/3D_RENDERING.md §9). The
    // idle bob therefore only advances while other animations already
    // drive frames — a settled crowd is as static as the old cones.
    if (moving) invalidate();
  });

  if (parts === null) return null;

  return (
    <group
      onClick={(event) => {
        if (event.instanceId === undefined) return;
        const marker = markers[event.instanceId];
        if (marker === undefined) return;
        event.stopPropagation();
        onSelect?.(marker.id);
      }}
    >
      {PART_NAMES.map((name) => (
        <instancedMesh
          key={name}
          ref={(mesh) => {
            partRefs.current[name] = mesh;
          }}
          args={[parts[name]?.geometry, name === 'body' || name === 'head' ? tintMaterial : limbMaterial, MAX_VISIBLE_AGENTS]}
          frustumCulled={false}
        />
      ))}
      <instancedMesh ref={pickRef} args={[undefined, undefined, MAX_VISIBLE_AGENTS]} frustumCulled={false}>
        <sphereGeometry args={[0.55, 8, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </instancedMesh>
      <instancedMesh ref={ringRef} args={[undefined, undefined, MAX_VISIBLE_AGENTS]} frustumCulled={false}>
        <ringGeometry args={[0.22, 0.34, 16]} />
        <meshBasicMaterial color="#fbe052" transparent opacity={0.45} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
```

- [ ] **Step 3: AgentCrowd.tsx 改为切换器（整文件替换）**

```typescript
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
  return <CitizenCrowd {...props} />;
}
```

- [ ] **Step 4: 验证**

```powershell
pnpm --filter @agent-republic/web typecheck
pnpm --filter @agent-republic/web build
```

Expected: 两条命令 exit 0。若 lint 报 `writePart` 依赖警告，把它包进 `useCallback`（依赖 `parts/dummy/offset`）。

### Task 4: 批次 1 视觉验证

- [ ] **Step 1: 启动 web（API 8787 已在跑则跳过其重启；先查端口）**

```powershell
Test-NetConnection -ComputerName localhost -Port 3000
```

若 3000 未监听：`npx next start`（cwd `apps\web`，后台）；8787 未监听同理启动 `apps/api`。

- [ ] **Step 2: Playwright 截图**

用既有模式（临时 mjs + `playwright-core` + 本机 Chrome，输出 `frontend-preview/`）截图 `http://localhost:3000/`，确认：小人可见、有走路摆腿、颜色区分、点击有金色光环。截图用 `computer://` 链接交付给用户确认。
（`prefers-reduced-motion` 下小人直接落位不摆动——符合 R-14。）

---

## 批次 2：四栋建筑 GLB

### Task 5: bpy 建筑建模脚本（含马桶大厦 4 阶段）

**Files:**
- Create: `tools/blender/build_landmarks.py`
- 产出: `council.glb` / `identity.glb` / `core.glb` / `project.glb` + 对应 `.blend`

- [ ] **Step 1: 写脚本**（结构同 Task 1 的 helpers；建筑在本地原点建模，位置由渲染端 manifest 决定；Blender Z-up，正面朝 -Y → glTF +Z 朝广场）

```python
"""Build the four District 01 landmark GLBs (low-poly, P0+).

Sizes are copied from packages/domain/src/scene/district-01.ts
(district-01@1, immutable manifest) — see BOUNDS below. The PROJECT tower
carries four switchable stage groups named stage_foundation / stage_frame /
stage_facade / stage_complete; the renderer toggles their visibility.

Run: & "G:\\blender\\blender.exe" --background --factory-startup --python tools\\blender\\build_landmarks.py
"""
import bpy
import json
import math
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "apps" / "web" / "public" / "world" / "district-01" / "v1"
BLEND_DIR = ROOT / "tools" / "blends"

# district-01.ts bounds [width, height, depth]: COUNCIL 7/9/7, IDENTITY 7/11/7,
# PROJECT 9/14/9, CORE 7/10/7. Ground footprint uses x/z in glTF (Blender x/y).
BOUNDS = {"COUNCIL": (7, 9, 7), "IDENTITY": (7, 11, 7), "PROJECT": (9, 14, 9), "CORE": (7, 10, 7)}

# Palette from apps/web/src/features/world-3d/buildings/palette.ts + UI_DESIGN.md
C_DARK = (0.165, 0.169, 0.149, 1.0)
C_GRAPHITE = (0.290, 0.294, 0.267, 1.0)
C_STEEL = (0.541, 0.545, 0.502, 1.0)
C_TEAL = (0.318, 0.722, 0.655, 1.0)
C_GOLD = (0.761, 0.639, 0.424, 1.0)
C_GREEN = (0.290, 0.420, 0.360, 1.0)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def make_mat(name, rgba, metallic=0.45, roughness=0.55, emission=None, strength=1.0, alpha=1.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    if alpha < 1.0:
        material.blend_method = "BLEND"
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Alpha"].default_value = alpha
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = strength
    return material


def box(name, dims, loc, material, parent, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def cyl(name, radius, depth, loc, material, parent, verts=16):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, location=loc, vertices=verts
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def cone(name, r1, r2, depth, loc, material, parent, verts=20):
    bpy.ops.mesh.primitive_cone_add(
        radius1=r1, radius2=r2, depth=depth, location=loc, vertices=verts
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def torus(name, major, minor, loc, material, parent):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, location=loc,
        major_segments=24, minor_segments=8,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def root_empty(name):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_council():
    """Stepped podium, horizontal chamber, roof grid — the short civic hall."""
    root = root_empty("COUNCIL")
    m_dark = make_mat("council_dark", C_DARK, 0.4, 0.65)
    m_graphite = make_mat("council_graphite", C_GRAPHITE, 0.45, 0.6)
    m_steel = make_mat("council_steel", C_STEEL, 0.55, 0.5)
    m_teal = make_mat("council_teal", C_TEAL, 0.2, 0.4, emission=C_TEAL, strength=1.1)

    box("podium", (7.0, 7.0, 0.9), (0, 0, 0.45), m_dark, root)
    box("tier", (5.6, 5.6, 1.8), (0, 0, 1.8), m_graphite, root)
    box("hall", (5.4, 4.2, 3.2), (0, 0.2, 4.3), m_steel, root)
    box("roof", (5.8, 4.6, 0.35), (0, 0.2, 6.05), m_graphite, root)
    for i in range(5):  # roof mullion grid
        x = -2.0 + i * 1.0
        box(f"mullion_x{i}", (0.1, 4.3, 0.12), (x, 0.2, 6.28), m_steel, root)
    for i in range(3):
        y = -1.4 + i * 1.4
        box(f"mullion_y{i}", (5.6, 0.1, 0.12), (0, y, 6.28), m_steel, root)
    for i in range(3):  # front steps toward the plaza (-Y)
        box(f"step{i}", (3.2 - i * 0.5, 0.7, 0.18), (0, -3.5 - 0.35 + i * 0.35, 0.09 + i * 0.18), m_graphite, root)
    box("entrance", (2.2, 0.1, 0.3), (0, -2.16, 3.0), m_teal, root)
    return root


def build_identity():
    """Slender archive tower with teal scan strips and a gold antenna."""
    root = root_empty("IDENTITY")
    m_dark = make_mat("identity_dark", C_DARK, 0.4, 0.6)
    m_graphite = make_mat("identity_graphite", C_GRAPHITE, 0.5, 0.5)
    m_steel = make_mat("identity_steel", C_STEEL, 0.55, 0.45)
    m_teal = make_mat("identity_teal", C_TEAL, 0.2, 0.4, emission=C_TEAL, strength=1.3)
    m_gold = make_mat("identity_gold", C_GOLD, 0.8, 0.35)

    box("podium", (5.2, 5.2, 1.0), (0, 0, 0.5), m_dark, root)
    box("tower", (3.2, 3.2, 7.6), (0, 0, 4.8), m_graphite, root)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("fin", (0.18, 0.18, 7.6), (sx * 1.45, sy * 1.45, 4.8), m_steel, root)
    for z in (2.6, 5.0, 7.4):  # scan frames on the plaza face (-Y)
        box(f"scan{z}", (2.6, 0.08, 0.14), (0, -1.66, z), m_teal, root)
    box("cap", (3.8, 3.8, 0.4), (0, 0, 8.8), m_dark, root)
    cyl("antenna", 0.07, 1.6, (0, 0, 9.8), m_steel, root)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.12, location=(0, 0, 10.65))
    tip = bpy.context.active_object
    tip.name = "antenna_tip"
    tip.data.materials.append(m_gold)
    tip.parent = root
    box("entrance", (1.4, 0.1, 0.5), (0, -1.66, 1.35), m_teal, root)
    return root


def build_core():
    """Data-center core: stacked octagonal drums, fins, gold band, beacon."""
    root = root_empty("CORE")
    m_dark = make_mat("core_dark", C_DARK, 0.4, 0.6)
    m_graphite = make_mat("core_graphite", C_GRAPHITE, 0.5, 0.5)
    m_steel = make_mat("core_steel", C_STEEL, 0.55, 0.45)
    m_teal = make_mat("core_teal", C_TEAL, 0.2, 0.4, emission=C_TEAL, strength=1.2)
    m_gold = make_mat("core_gold", C_GOLD, 0.8, 0.3)

    box("base", (6.0, 6.0, 0.7), (0, 0, 0.35), m_dark, root)
    for i, z in enumerate((1.85, 4.2, 6.55)):
        cyl(f"drum{i}", 2.6, 2.2, (0, 0, z), m_graphite, root, verts=8)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("fin", (0.2, 0.2, 6.9), (sx * 2.35, sy * 2.35, 4.15), m_steel, root)
    cyl("band", 2.78, 0.18, (0, 0, 7.75), m_gold, root, verts=8)
    cyl("topdisc", 1.9, 0.3, (0, 0, 8.0), m_dark, root, verts=16)
    cyl("mast", 0.08, 1.2, (0, 0, 8.75), m_steel, root)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.14, location=(0, 0, 9.4))
    beacon = bpy.context.active_object
    beacon.name = "beacon"
    beacon.data.materials.append(m_teal)
    beacon.parent = root
    for x in (-1.2, 0, 1.2):  # light slits on the plaza face (-Y)
        box(f"slit{x}", (0.4, 0.06, 0.7), (x, -2.63, 4.2), m_teal, root)
    return root


def build_project():
    """Golden Toilet Tower with four switchable stage groups (design doc §3)."""
    root = root_empty("PROJECT")
    w, h, d = BOUNDS["PROJECT"]
    shaft_w, shaft_d = w * 0.56, d * 0.56
    shaft_h = 9.8
    shaft_top = 0.9 + shaft_h
    rim_r = w * 0.38

    m_dark = make_mat("p_dark", C_DARK, 0.4, 0.65)
    m_graphite = make_mat("p_graphite", C_GRAPHITE, 0.6, 0.42)
    m_steel = make_mat("p_steel", C_STEEL, 0.65, 0.4)
    m_gold = make_mat("p_gold", C_GOLD, 0.85, 0.3)
    m_gold_glow = make_mat("p_gold_glow", C_GOLD, 0.7, 0.35, emission=C_GOLD, strength=1.2)
    m_teal = make_mat("p_teal", C_TEAL, 0.2, 0.4)
    m_wire = make_mat("p_wire", C_TEAL, 0.0, 0.5, alpha=0.14)

    box("plinth", (w * 0.92, d * 0.92, 0.9), (0, 0, 0.45), m_dark, root)

    foundation = root_empty("stage_foundation"); foundation.parent = root
    box("slab", (shaft_w * 1.16, shaft_d * 1.16, 0.18), (0, 0, 0.99), m_graphite, foundation)
    for cx in (-1, 0, 1):
        for cz in (-1, 0, 1):
            box("stub", (0.3, 0.3, 1.6), (cx * shaft_w * 0.36, cz * shaft_d * 0.36, 1.8), m_steel, foundation)
    box("hologram", (shaft_w, shaft_d, shaft_h), (0, 0, 0.9 + shaft_h / 2), m_wire, foundation)
    mast_x, mast_y = shaft_w / 2 + 0.8, -shaft_d / 2 - 0.6
    box("crane_mast", (0.26, 0.26, 6.6), (mast_x, mast_y, 0.9 + 3.3), m_steel, foundation)
    box("crane_jib", (5.4, 0.14, 0.14), (mast_x - 2.7, mast_y, 7.35), m_steel, foundation)
    box("crane_counter", (1.0, 0.14, 0.14), (mast_x + 0.5, mast_y, 7.35), m_steel, foundation)
    box("crane_cable", (0.04, 0.04, 5.3), (mast_x - 5.2, mast_y, 4.55), m_steel, foundation)
    box("crane_hook", (0.24, 0.24, 0.24), (mast_x - 5.2, mast_y, 1.85), m_gold, foundation)

    frame = root_empty("stage_frame"); frame.parent = root
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("column", (0.32, 0.32, shaft_h), (sx * (shaft_w / 2 - 0.18), sy * (shaft_d / 2 - 0.18), 0.9 + shaft_h / 2), m_steel, frame)
    for fraction in (0.2, 0.4, 0.6, 0.8, 1.0):
        box("floor", (shaft_w, 0.16, shaft_d), (0, 0, 0.9 + shaft_h * fraction), m_graphite, frame)
    box("arm", (1.8, 0.14, 0.14), (shaft_w / 2 + 0.9, 0, shaft_top + 0.35), m_gold, frame)

    facade = root_empty("stage_facade"); facade.parent = root
    box("shaft", (shaft_w, shaft_h, shaft_d), (0, 0, 0.9 + shaft_h / 2), m_graphite, facade)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("fin", (0.16, 0.16, shaft_h), (sx * shaft_w / 2, sy * shaft_d / 2, 0.9 + shaft_h / 2), m_gold, facade)
    for z in (3.2, 6.1):
        box("band", (shaft_w * 0.82, 0.06, 0.06), (0, -shaft_d / 2 - 0.02, z), m_gold_glow, facade)
    cone("bowl", rim_r, shaft_w * 0.46, 1.2, (0, 0, shaft_top + 0.6), m_steel, facade, verts=24)
    torus("rim", rim_r * 0.94, 0.16, (0, 0, shaft_top + 1.12), m_gold, facade)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("post", (0.07, 0.07, 1.8), (sx * rim_r * 0.8, sy * rim_r * 0.8, shaft_top + 0.9), m_steel, facade)
    for sign in (-1, 1):
        box("beam_x", (rim_r * 1.6, 0.07, 0.07), (0, sign * rim_r * 0.8, shaft_top + 1.8), m_steel, facade)
        box("beam_y", (0.07, 0.07, rim_r * 1.6), (sign * rim_r * 0.8, 0, shaft_top + 1.8), m_steel, facade)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("equipment", (0.24, 0.08, 0.14), (sx * shaft_w * 0.36, sy * (shaft_d / 2 + 0.03), shaft_top - 0.4), m_gold_glow, facade)

    complete = root_empty("stage_complete"); complete.parent = root
    box("shaft", (shaft_w, shaft_h, shaft_d), (0, 0, 0.9 + shaft_h / 2), m_graphite, complete)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("fin", (0.16, 0.16, shaft_h), (sx * shaft_w / 2, sy * shaft_d / 2, 0.9 + shaft_h / 2), m_gold, complete)
    for z in (3.2, 6.1):
        box("band", (shaft_w * 0.82, 0.06, 0.06), (0, -shaft_d / 2 - 0.02, z), m_gold_glow, complete)
    cone("bowl", rim_r, shaft_w * 0.46, 1.2, (0, 0, shaft_top + 0.6), m_steel, complete, verts=24)
    torus("rim", rim_r * 0.94, 0.16, (0, 0, shaft_top + 1.12), m_gold, complete)
    cyl("lid", rim_r * 0.8, 0.16, (0, 0, shaft_top + 1.28), m_dark, complete, verts=24)
    box("plaque", (2.4, 1.1, 1.9), (0, -rim_r * 0.62, shaft_top + 0.85), m_graphite, complete)
    box("plaque_light", (1.6, 0.1, 0.5), (0, -4.12, 0.55), m_gold_glow, complete)
    cyl("beacon", 0.13, 0.6, (0, 0, shaft_top + 1.6), m_gold_glow, complete, verts=12)
    return root


def export_root(root, filename):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    out = OUT_DIR / filename
    bpy.ops.export_scene.gltf(
        filepath=str(out), export_format="GLB", use_selection=True, export_apply=True
    )
    tris = sum(len(c.data.polygons) for c in root.children_recursive if c.type == "MESH")
    print("LANDMARK_RESULT " + json.dumps({"file": filename, "bytes": out.stat().st_size, "tris": tris}))


clear_scene()
OUT_DIR.mkdir(parents=True, exist_ok=True)
BLEND_DIR.mkdir(parents=True, exist_ok=True)
for builder, name in ((build_council, "council.glb"), (build_identity, "identity.glb"),
                      (build_core, "core.glb"), (build_project, "project.glb")):
    root = builder()
    export_root(root, name)
    # Remove the exported building so the next export selects only its own root.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / "landmarks.blend"))
```

- [ ] **Step 2: 运行并验证**

```powershell
& "G:\blender\blender.exe" --background --factory-startup --python "tools\blender\build_landmarks.py"
```

Expected: 四行 `LANDMARK_RESULT`，每栋 tris ≤ 35000、bytes 各 ≤ 400KB。project.glb 用 node 快速验证阶段组：

```powershell
node -e "const fs=require('fs');const b=fs.readFileSync('apps/web/public/world/district-01/v1/project.glb');const s=b.toString('latin1');['stage_foundation','stage_frame','stage_facade','stage_complete'].forEach(n=>console.log(n, s.includes(n)))"
```

Expected: 四个 `true`。

### Task 6: 建筑接入 WorldScene（GLB + fallback + 阶段切换）

**Files:**
- Modify: `apps/web/src/features/world-3d/WorldScene.tsx`（LandmarkModel 及其上方）

- [ ] **Step 1: 修改**

在 import 区加：

```typescript
import { useGltfScene } from './assets/useGltfScene';
```

在 `LandmarkModel` 定义前加：

```typescript
/** P0+ — GLB model per landmark; PLAZA keeps its procedural plaza (no URL). */
const LANDMARK_MODEL_URLS: Partial<Record<LandmarkId, string>> = {
  COUNCIL: '/world/district-01/v1/council.glb',
  IDENTITY: '/world/district-01/v1/identity.glb',
  PROJECT: '/world/district-01/v1/project.glb',
  CORE: '/world/district-01/v1/core.glb',
};

const PROJECT_STAGE_KEYS: Record<ProjectStage | null, string> = {
  null: 'stage_foundation',
  FOUNDATION: 'stage_foundation',
  FRAME: 'stage_frame',
  FACADE: 'stage_facade',
  COMPLETE: 'stage_complete',
};

/** Toggles the four named stage groups; a reload shows the final pose. */
function applyProjectStage(scene: THREE.Group, stage: ProjectStage | null) {
  const visibleKey = PROJECT_STAGE_KEYS[stage];
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
```

`LandmarkModel` 改为：

```typescript
function LandmarkModel({
  landmark,
  stage,
  selected,
  onSelect,
}: {
  landmark: Landmark;
  stage: ProjectStage | null;
  selected: boolean;
  onSelect?: (id: LandmarkId) => void;
}) {
  const Model = LANDMARK_BUILDINGS[landmark.id];
  const [x, y, z] = landmark.position;
  const glb = useGltfScene(LANDMARK_MODEL_URLS[landmark.id] ?? null);

  return (
    <group
      position={[x, y, z]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(landmark.id);
      }}
    >
      {glb === null ? (
        <Model bounds={landmark.bounds} stage={stage} />
      ) : (
        <LandmarkGlb scene={glb} landmark={landmark} stage={stage} />
      )}
      {selected ? <SelectionOutline landmark={landmark} /> : null}
    </group>
  );
}
```

- [ ] **Step 2: 验证**

```powershell
pnpm --filter @agent-republic/web typecheck
pnpm --filter @agent-republic/web build
```

Expected: exit 0。

### Task 7: 批次 2 回归 + 四阶段截图

- [ ] **Step 1:** `pnpm lint` → exit 0
- [ ] **Step 2:** `pnpm test:visual`（自带服务器编排）。若像素断言因新模型失败：按既有快照更新机制更新期望值（确认差异仅为新模型，无布局回归）。
- [ ] **Step 3:** 用 DEMO fixture（0/500/1200/2000 BUILD）各截一张 `/` 图，确认 4 阶段组切换正确、点击建筑仍路由正确。截图交付用户。

---

## 批次 3：环境精装 + 资产治理

### Task 8: bpy 环境脚本

**Files:**
- Create: `tools/blender/build_environment.py` → `environment.glb`

- [ ] **Step 1: 写脚本**（helpers 同 Task 5；坐标抄自 `district-01.ts` 的 WAYPOINTS/EDGES，注释标注来源）

```python
"""Build environment.glb — plaza paving, waypoint streets, streetlights,
greenery and one drifting airship node named 'airship' (animated in code).

Waypoint coordinates and edges are copied from
packages/domain/src/scene/district-01.ts (district-01@1, immutable).
Run: & "G:\\blender\\blender.exe" --background --factory-startup --python tools\\blender\\build_environment.py
"""
import bpy
import json
import math
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "apps" / "web" / "public" / "world" / "district-01" / "v1"
OUT = OUT_DIR / "environment.glb"

# district-01.ts DISTRICT_01_WAYPOINTS (Blender Z-up: glTF x = x, y = -z).
WAYPOINTS = {
    "P0": (0, 0), "P1": (-4, 0), "P2": (4, 0), "P3": (0, 4), "P4": (0, -4),
    "P5": (-4, 4), "P6": (4, 4), "P7": (-4, -4), "P8": (4, -4),
    "P9": (-9, 1), "P10": (9, 1), "P11": (-8, -3), "P12": (9, -4),
}
EDGES = [("P0","P1"),("P0","P2"),("P0","P3"),("P0","P4"),("P1","P5"),("P1","P7"),
         ("P2","P6"),("P2","P8"),("P3","P5"),("P3","P6"),("P4","P7"),("P4","P8"),
         ("P1","P9"),("P2","P10"),("P7","P11"),("P8","P12")]

C_DARK = (0.165, 0.169, 0.149, 1.0)
C_GRAPHITE = (0.290, 0.294, 0.267, 1.0)
C_STEEL = (0.541, 0.545, 0.502, 1.0)
C_TEAL = (0.318, 0.722, 0.655, 1.0)
C_GOLD = (0.761, 0.639, 0.424, 1.0)
C_GREEN = (0.290, 0.420, 0.360, 1.0)

# ... make_mat / box / cyl / cone / torus / root_empty: copy verbatim from
# tools/blender/build_landmarks.py (keep both files self-contained) ...


def build_environment():
    # clear_scene + make_mat/box/cyl/cone/torus/root_empty as in build_landmarks.py
    root = root_empty("Environment")
    m_graphite = make_mat("env_graphite", C_GRAPHITE, 0.3, 0.7)
    m_dark = make_mat("env_dark", C_DARK, 0.3, 0.75)
    m_teal = make_mat("env_teal", C_TEAL, 0.2, 0.4, emission=C_TEAL, strength=0.9)
    m_gold = make_mat("env_gold", C_GOLD, 0.8, 0.35)
    m_green = make_mat("env_green", C_GREEN, 0.1, 0.8)
    m_trunk = make_mat("env_trunk", C_DARK, 0.2, 0.8)

    # Plaza: two octagonal paving drums plus a flat gold inlay ring.
    cyl("plaza_outer", 3.4, 0.06, (0, 0, 0.03), m_graphite, root, verts=8)
    cyl("plaza_inner", 2.2, 0.07, (0, 0, 0.035), m_dark, root, verts=8)
    torus("plaza_ring", 2.8, 0.05, (0, 0, 0.075), m_gold, root)

    # Streets along every waypoint edge (dark strips, slightly above ground).
    for a, b in EDGES:
        ax, ay = WAYPOINTS[a]; bx, by = WAYPOINTS[b]
        length = math.hypot(bx - ax, by - ay)
        angle = math.atan2(by - ay, bx - ax)
        box(f"street_{a}_{b}", (length + 0.4, 1.3, 0.04),
            ((ax + bx) / 2, (ay + by) / 2, 0.02), m_dark, root, rot=(0, 0, angle))

    # Waypoint dots (low-emission teal).
    for name, (x, y) in WAYPOINTS.items():
        cyl(f"dot_{name}", 0.14, 0.05, (x, y, 0.045), m_teal, root, verts=8)

    # Streetlights at the four inner waypoints.
    for name, (x, y) in (("P1", WAYPOINTS["P1"]), ("P2", WAYPOINTS["P2"]),
                         ("P3", WAYPOINTS["P3"]), ("P4", WAYPOINTS["P4"])):
        cyl(f"pole_{name}", 0.05, 2.2, (x - 0.5, y - 0.5, 1.1), m_graphite, root, verts=8)
        box(f"lamp_{name}", (0.34, 0.18, 0.12), (x - 0.5, y - 0.5, 2.2), m_teal, root)

    # Greenery outside the building footprints (fixed, deterministic spots).
    for i, (x, y) in enumerate(((-13, -12), (13, -12), (-14, 6), (14, 6), (-3, 13), (3, 13))):
        cyl(f"trunk{i}", 0.09, 0.5, (x, y, 0.25), m_trunk, root, verts=7)
        cone(f"foliage{i}", 0.55, 0.0, 1.3, (x, y, 1.15), m_green, root, verts=7)

    # Airship: named node the renderer drifts gently (no skeleton).
    airship = root_empty("airship"); airship.parent = root
    airship.location = (0, 0, 18)
    m_steel = make_mat("env_steel", C_STEEL, 0.55, 0.45)
    body = bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, location=(0, 0, 18))
    hull = bpy.context.active_object
    hull.name = "airship_hull"
    hull.scale = (2.6, 1.0, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    hull.data.materials.append(m_steel)
    hull.parent = airship
    box("airship_gondola", (1.1, 0.5, 0.4), (0, 0, 16.9), m_graphite, airship)
    for z in (-0.25, 0.25):
        box("airship_fin", (0.5, 0.06, 0.5), (-2.4, 0, 18 + z), m_gold, airship)
    return root


clear_scene()
OUT_DIR.mkdir(parents=True, exist_ok=True)
root = build_environment()
bpy.ops.object.select_all(action="DESELECT")
root.select_set(True)
for child in root.children_recursive:
    child.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=str(OUT), export_format="GLB", use_selection=True, export_apply=True
)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / "environment.blend"))
tris = sum(len(c.data.polygons) for c in root.children_recursive if c.type == "MESH")
print("ENVIRONMENT_RESULT " + json.dumps(
    {"file": str(OUT), "bytes": OUT.stat().st_size, "tris": tris}
))
```

（`BLEND_DIR = ROOT / "tools" / "blends"` 与 Task 5 相同，写在文件头部常量区。）

- [ ] **Step 2: 运行并验证**（同 Task 5 命令模式），Expected：`tris ≤ 8000`、`bytes ≤ 300KB`。

### Task 9: DistrictEnvironment 组件

**Files:**
- Create: `apps/web/src/features/world-3d/assets/DistrictEnvironment.tsx`
- Modify: `apps/web/src/features/world-3d/WorldScene.tsx`（挂载）

- [ ] **Step 1: 写组件**

```typescript
'use client';

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGltfScene } from './useGltfScene';

/**
 * P0+ — static environment set (plaza paving, streets, lights, greenery)
 * plus the 'airship' node drifting gently. The drift never calls
 * invalidate(), so the demand render loop stays idle when nothing else
 * moves; the airship only advances while other animations already drive
 * frames (docs/3D_RENDERING.md §9).
 */
export function DistrictEnvironment() {
  const scene = useGltfScene('/world/district-01/v1/environment.glb');
  const airship = useMemo(() => scene?.getObjectByName('airship') ?? null, [scene]);

  useFrame(({ clock }) => {
    if (airship === null) return;
    const t = clock.elapsedTime;
    airship.position.set(Math.sin(t * 0.06) * 2.5, 18 + Math.sin(t * 0.4) * 0.35, Math.cos(t * 0.06) * 2.5);
    airship.rotation.y = Math.sin(t * 0.06) * 0.4;
  });

  if (scene === null) return null;
  return <primitive object={scene} />;
}
```

- [ ] **Step 2: WorldScene 挂载**：import 后在 `<Ground onClear={onClearSelection} />` 下一行加 `<DistrictEnvironment />`。

- [ ] **Step 3: 验证**：`pnpm --filter @agent-republic/web typecheck && pnpm --filter @agent-republic/web build`（分开跑，PowerShell 5 无 `&&`）。

### Task 10: 资产 manifest + 许可声明 + 体积审计

**Files:**
- Create: `apps/web/public/world/district-01/v1/assets.json`
- Create: `apps/web/public/assets/LICENSES.md`
- Create: `scripts/audit-world-assets.mjs`

- [ ] **Step 1: assets.json**

```json
{
  "schemaVersion": "1",
  "sceneVersion": "district-01@1",
  "license": "original-work",
  "author": "AGENT REPUBLIC team (procedural bpy scripts in tools/blender/)",
  "assets": [
    { "file": "agent-citizen.glb", "license": "original-work", "note": "low-poly citizen, rig-ready named parts" },
    { "file": "council.glb", "license": "original-work", "note": "Council Hall" },
    { "file": "identity.glb", "license": "original-work", "note": "Identity Centre" },
    { "file": "core.glb", "license": "original-work", "note": "Agent Core" },
    { "file": "project.glb", "license": "original-work", "note": "Golden Toilet Tower with 4 stage groups" },
    { "file": "environment.glb", "license": "original-work", "note": "plaza, streets, lights, greenery, airship" }
  ]
}
```

- [ ] **Step 2: LICENSES.md**

```markdown
# World asset licenses

All 3D assets under `world/district-01/v1/` are original works generated by
the AGENT REPUBLIC team with the bpy scripts in `tools/blender/` (see
`assets.json` for the per-file manifest). No third-party assets are used.
```

- [ ] **Step 3: 审计脚本**

```javascript
// scripts/audit-world-assets.mjs — reports GLB sizes against the 1.5MB budget
// (docs/3D_RENDERING.md §9: total new assets <= 3MB, half reserved for models).
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'apps/web/public/world/district-01/v1');
const files = readdirSync(dir).filter((f) => f.endsWith('.glb'));
let total = 0;
for (const file of files) {
  const bytes = statSync(join(dir, file)).size;
  total += bytes;
  console.log(`${file}: ${(bytes / 1024).toFixed(1)} KB`);
}
console.log(`total: ${(total / 1024).toFixed(1)} KB (budget 1536 KB)`);
process.exit(total > 1536 * 1024 ? 1 : 0);
```

- [ ] **Step 4: 运行** `node scripts/audit-world-assets.mjs` → exit 0。

### Task 11: 全量回归 + 最终交付

- [ ] **Step 1:** `pnpm lint`、`pnpm --filter @agent-republic/web typecheck`、`pnpm --filter @agent-republic/web build` → 全部 exit 0
- [ ] **Step 2:** `pnpm test:visual`、`pnpm test:responsive`、`pnpm test:a11y` → 全部通过（视觉断言如因新模型变化，先确认差异仅为模型本身再更新期望）
- [ ] **Step 3:** 关键回归点人工核对：GLB 改名/删除一个文件 → 页面回退程序化版本不白屏；`prefers-reduced-motion` → 无摆腿/漂移；点击建筑/agent 路由不变；PROJECT 四阶段正确
- [ ] **Step 4:** 截图全景（含小人、建筑、环境）交付用户验收
