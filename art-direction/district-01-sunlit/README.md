# District 01 · 晴天街区建模参考

这套图为 E6-02 的美术探索，采用 `district-01@1` 的 40 × 40 米街区。阳光打在奶油色拱券和薄荷绿釉面上，投下的阴影让墙面、雨棚、招牌支架的前后关系更容易辨认。远看靠穹顶、证件牌、网壳和屋顶雕塑识别功能，近看再补拼缝、压条和固定件。

[街景原图](01-district-street.png) · [施工阶段原图](06-construction-stages.png)

## Blender 起模尺寸

先按米建立下表中的包围盒，将原点放在地基中心。宽、深、高均含外挑招牌和屋顶构件；高为上限。图中人物仅供感受街道尺度。各视图由内置 ImageGen 生成，局部比例、窗格和挂件位置可能有偏差。定尺寸时以[场景清单](../../packages/domain/src/scene/district-01.ts)为准。

| 建筑原图 | 地基中心（世界 X, Z） | 宽 × 深 × 高（米） | 建议先拆出的模块 |
| --- | --- | --- | --- |
| [议会大厅](02-council-hall.png) | −9, −6 | 7 × 7 × 9 | 方形台基、三跨拱廊、采光鼓座、可重复的穹顶瓣片 |
| [身份中心](03-identity-center.png) | 9, −6 | 7 × 7 × 11 | 档案塔、折线窗带、双扫描门、冰蓝证件及黄铜支架 |
| [Agent 核心](04-agent-core.png) | 9, 9 | 7 × 7 × 10 | 环形基座、散热百叶、烟灰玻璃筒、重复三角网壳 |
| [黄金马桶大厦](05-golden-toilet-tower.png) | −8, 9 | 9 × 9 × 14 | 含转角的外墙模组、雨棚、屋顶安装座、独立金色雕塑 |
| 中央广场（见街景） | 0, 0 | 7 × 7 × 0.1 | 环形铺装、路缘与长椅 |

场景清单使用 Three.js 的 Y 轴向上；Blender 的 Z 轴向上。表中的世界 X、Z 是游戏平面坐标。街景从南侧向广场看，远处天际线用于表现空气透视。四张单栋图均包含斜视、正面、侧面和顶视。

## 施工分件

让地基、立柱和楼板在四个阶段沿用同一坐标。地基阶段只摆基础和小龙门吊；钢架阶段增加承重构件；立面阶段安装窗墙和屋顶底座，保留一角外露结构。完工形态再封闭立面并安装金色雕塑。这四种形态是用于制作模型的设计示意。阶段显示条件见[项目施工规范](../../docs/3D_RENDERING.md#4-项目施工阶段的精确视觉规则)。

<details>
<summary>展开 ImageGen 生成提示词</summary>

### 街景

```text
Use case: stylized-concept. Make an original landscape game environment keyframe for AGENT REPUBLIC, District 01. The supplied image is solely a reference for sunny art direction: big sculpted cloud banks, early 2000s East Asian urban street design, brave three-dimensional shop signs, humorous oversized objects built into facades, alternating bands of painted trim, matte ceramic paint, blue sunlit glass, and warm, directional late morning light. Match its sophisticated animated-film 3D material rendering, sense of urban life and graphic rhythm. Invent a new composition and original civic architecture. NO trademark, existing shopfront, familiar character, brand, vehicle facade, red overpass, giant cat, or reference lettering.
Horizontal architectural photograph from the paving at the southern edge looking toward a small public plaza in a dense, compact 40-metre-square pedestrian city block. Lively scale, cinematic 28mm eye level, warm sun from upper left, cloud shadows and carefully layered background; do not make an isometric board game or floating island. Compose the shot like a place someone could walk through, tiled paving foreground, the plaza's open center leads the eye to the council and identity center. Four purpose-built landmarks and no additional full building in the playable site. At BACK LEFT is a squat assembly hall of charcoal base, cream enamel tiled ribs, 3 deep arch bays, a teal segmented low dome on a drum, orange rolled marquee carrying a simple sculptural speech icon. At BACK RIGHT a thin jade tiled archive tower with staggered vertical window band, outsized translucent ice-blue corner identity badge with a simple abstract embossed ID silhouette, paired square scanner portal at entrance. At NEAR RIGHT, partially framing the scene, a round computer exchange, stacked smoke glass drum with a faceted brass triangular diagrid, mint horizontal metal louvers, cream rounded plinth and orange access hatch. At NEAR LEFT a LOW fenced building foundation, structural sockets and small gantry, simple schematic of an architectural tower topped with an elegant golden toilet silhouette painted on its site barrier. This foreground lot must read as a foundation, open to the sky. Ensure plaza sightline, attractive canopies, street cabinets, purposeful hanging enamel blade signs, benches, one or two stylized ordinary agent figures for scale, tiny greenery. Colors: buttercream, jade, apricot, graphite ceramic plinths, softened aquamarine and aged brass. A few chunky Chinese typographic accents on signs if legible: “议会” and “身份”. No infographics, no overlay, no data, no header, no watermark. Rich sharp original concept art consistent with a modelable small game environment.
```

### 单栋图共用提示词

```text
Use case: stylized-concept. Produce a clean landscape architectural MODEL SHEET for a Blender environment artist. Input is the art-directed original District 01 plaza concept used to lock materials, architectural forms and color proportions. This new sheet isolates ONE building. Make a restrained, beautifully printed industrial design plate, pale warm gray paper background, soft small contact shadows, no surroundings; high clarity, flat neutral 3D studio light, detailed bevels, continuous bands in enameled metal, baked ceramic tiles, subtle material roughness. Distinctly stylized bright Chinese civic streetscape, creamy ceramic, jade, smoke-gray and sparks of apricot, design from the reference.
Use four complete well-separated views of THE IDENTICAL asset, LARGE FRONT THREE-QUARTER at left and technical front, right, and top orthographic views at right. Use a wide landscape format, large drawings and slim gutters. Front and right have an identical ground baseline and scale, use true orthographic no foreshortening. The three-quarter should clearly show roof surface and door. On every view rigorously match window divisions, signs, major roof geometry, facade materials, story heights and door placements. Include the whole asset including the base and rooftop tip fully inside the paper. Use a single 1.7 m muted gray scale mannequin next to the axonometric, clearly separate from model, estimate proportions relative to this human. One concise title using exact English name given below, and tiny view labels if appropriate. Omit technical dimensions and numbers; official dimensions will be supplied separately. Zero fake technical copy, spurious arrows, blank placeholders, filler color swatches, dramatic lens distortion or extra objects.
```

### 议会大厅

```text
Title "COUNCIL HALL". Isolate the BACK LEFT building in the reference. Interpret it in a small bounding envelope of 7m W x 7m D x 9m max H, a working little town hall, not a grand monumental capitol. Preserve its broad, low segmented jade copper dome with brass ribs on a glazed clerestory drum, visible under-dome band and single small finial. Ground floor has EXACTLY THREE equal deep cream ceramic ribbed arches including the central entrance above a short flight of steps, graphite tiles to the sides and on the plinth. Keep the burnt apricot rounded rectangular enamel fascia with raised speech bubble and "议会". Make the handrail, glass double entry and main cornice modelable. Rear service zone simple and compact.
```

### 身份中心

```text
Title "IDENTITY CENTER". Isolate the thin rectangular mint/jade archive tower in the center right of the reference. Envelope 7m W x 7m D x 11m max H. Preserve flat layered rounded white roof, jade square tile planar walls, offset vertical deep-blue glass band with continuous pale cream horizontal projecting sunshades on the front left, right corner with a massive translucent icy-blue laminated ID card carried on brass brackets near roof, below it vertical green enamel sign reading "身份". Retain two matching squared teal scanner gates side-by-side underneath shallow projecting entry canopy. The novelty ID card is like a thick molded translucent object with an embossed faceless profile, mounted perpendicular-ish at a credible readable angle. One tidy functional, simpler right side. same facade each time.
```

### Agent 核心

```text
Title "AGENT CORE". Reconstruct the near-right round computing exchange partly cut off in the reference and show it complete. Envelope 7m W x 7m D x 10m max H. A compact cylindrical stack with subtly faceted circumference: robust cream tiled plinth with ONE rounded rectangular orange service hatch as door, middle belt of fine stacked mint metal louvers, upper dark smoky glass story, real gold/brass triangular diagrid on the outside with raised round bolt disks at intersections, large soft cream rolled fascia ring at top, stepped jade round roof vent. A few dark server chassis can be glimpsed through the smoked glass, no computers outside the building. Circular building base, one small projecting teal blade sign with a simple terminal pictogram. Clear enough to count instances around the ring. Preserve the human-scale city proportions unlike a space station.
```

### 黄金马桶大厦

```text
Title "GOLDEN TOILET TOWER". New completed design of the planned civic project whose simple gold toilet symbol appears on the left construction fence of the reference. This standalone reference is a future-stage model study. The FOOTPRINT is square 9m W x 9m D, 14m max height including the sculptural sign. A medium-rise whimsical Streamline Moderne PUBLIC EXHIBITION PAVILION with only three human-scale levels, slender vertical graphite ceramic corner pilasters, two strong bands of pale jade and creamy enameled panels, rounded chamfered corners, rusty apricot rounded entrance canopy and small side service hatch. An elegant but immediately unmistakable freestanding polished champagne-GOLD TOILET SCULPTURE on a low rooftop mounting drum, a single open elliptical bowl with rolled rim and a modest upright rounded rectangular cistern behind it. This is THE hero silhouette; represent it honestly and with witty civic pride, tasteful like a vintage commercial building's gigantic roof sign, no cartoon eyes, no bathroom interior, no vulgar imagery. Fixed orientation, bowl opening toward the front / entrance, cistern towards rear in all views. Other walls must remain cream, graphite and jade so the gold reads on the roof. Show complete facade and one complete roof sculpture in each view. Only depict the completed design on this sheet, no construction phases.
```

### 黄金马桶大厦招牌定稿

```text
Use case: text-localization. Make a tiny correction to this otherwise finished Blender reference sheet. On the central green enamel plaque above the doors in the large three-quarter drawing and the small front elevation, remove every Chinese glyph, retaining the existing simple gold toilet pictogram and center it attractively vertically and horizontally on the green enamel plaque. This pictogram is the only content on the green plaque, both views. Keep all the English text elsewhere on the page, title, four drawings, small mannequin, architecture, roof sculpture detail and orientation, joints, material colors, proportions, composition, orthographic view positions, margins and resolution visually unchanged.
```

### 施工阶段

```text
Use case: stylized-concept. Make a single beautiful wide landscape production reference plate showing the FOUR game construction states of one small whimsical Chinese civic tower. The supplied architectural model sheet is the visual master for the complete asset. Four evenly spaced freestanding maquettes, in a single left-to-right row or a generous two by two grid as fits best. Every model rests on the IDENTICAL square footprint, exactly the same camera elevation, azimuth, object scale and floor interval; the earlier incomplete models are physically shorter. Warm light gray neutral paper, small soft studio shadows, clean and readable. No sky, obstructions or people. Exact top title "GOLDEN TOILET TOWER", subtitle "CONSTRUCTION STUDY", one exact short label under each model in order "FOUNDATION", "FRAME", "FACADE", "COMPLETE". No progress numbers, captions, fake annotations, text on the model, or rulers. The intended envelope is 9 by 9 metres ground and 14 metres max height, dimensions are external guidance only.
FOUNDATION: only low concrete footings and stubby rebar sockets, a small construction gantry (no rising storeys), pale chalk dashed plan on slab.
FRAME: now erect the graphite load-bearing posts, two elevated floor slabs, exposed canopy supports, open bays, small engineering hoist, no cladding or glass. Keep corner posts in same exact positions as in final tower.
FACADE: nearly built, full architectural envelope of the main pavilion, glazing and mint ribbon already fitted on two levels, a single obvious corner section still exposed, a bit of scaffolding and a bare CIRCULAR rooftop mounting drum waiting for its sculpture. NO toilet on this model.
COMPLETE: faithfully reproduce the final building from the provided biggest view, with cream ceramic walls and graphite tapered uprights, blue-gray windows, jade horizontals, apricot rounded door marquee, green panel with a SINGLE simple gold toilet pictogram and NO writing below it. Large polished gold toilet sculpture sits on the rooftop drum in the exact same attitude as the reference, cistern behind and bowl forward. Reproduce buildable architecture with smooth bevels and physical materials, keep camera same as other three. No stage outside COMPLETE may have the gold roof sculpture.
```

</details>
