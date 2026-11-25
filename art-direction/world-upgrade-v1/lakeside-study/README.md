# NEXCIV 湖畔城市 · E6-07 美术样板

## 网页街区观察

启动 Web 应用后打开 [街区观察](http://127.0.0.1:3137/nexciv-preview)。01 号 Agent 从 Nexus 广场南侧出发，03 号研究员从广场北侧出发。可在「跟随 01」「跟随 03」或「俯视」之间切换，拖动和缩放镜头。按「暂停动画」可观察定格姿势。系统减少动态效果时默认从静止俯视开始，可以主动播放。

三个可到访地点是 Nexus 中央广场、Corner Market 和议会大厅。01、03 到达后各自从已加载且可达的地点重新选择，按角色偏好、访问次数和路程评分。路径由双向路段拼接，商铺到议会大厅约 194 米，中途沿广场东侧绕过 Nexus 主体。两名 Agent 使用独立的步行轨迹。将网页 GLB 重新导入 Blender 校验后，790 个采样点的支撑高度最大误差为 2.5 厘米。北侧路线加载失败时，01 号仍可在已连接的南侧地点间活动。[跨区到访实测截图](renders/NEXCIV_Web_Agent_Routing.jpg)。

选点在试玩页内运行，每次刷新用相同的初始偏好和访问记录启动。这套演示使用独立的路网与状态。已在 Edge 验证 01 号从商铺直接到议会大厅、03 号从议会大厅前往商铺、商铺问候和跟拍切换。触屏模拟验证了北侧资源失败时的南侧路线降级，以及减少动态效果时的手动播放。

```powershell
pnpm --filter @agent-republic/web dev --port 3137
```

南侧从下方的道路修正版导出为三份 GLB。首屏加载 2.81 MB 的街区底包与 1.44 MB 的角色包，画面包括完整路面、斑马线、坡道和建筑外轮廓。进入南侧跟拍或拉近俯视后，加载 5.21 MB 的沿街精细包，更新行道树、商铺与小设施。Agent 或镜头距商铺入口不到 29 米时，加载 5.01 MB 的 Corner Market 精细包，原位换入玻璃、金属收边与门厅。细节请求失败时继续显示首屏已经加载的场景。

北线约 76.3 米，包含 157 个地面采样点。北区以约 4.90 MB 的独立 GLB 接在已有路网上。议会大厅前的 12 道斑马线划入原沥青网格。默认在 01 号起步后下载北区与 03 号模型，点击「跟随 03」也可以提前加载。北区请求失败时仍可继续观察 01 号。[北线出发、过街及到场截图](renders/NEXCIV_Web_Governance_Preview.jpg)。

Corner Market 门前保留约 4.4 秒的问候。01 号接近时，02 号工人沿门前人行道走 4.25 米，等候在离 01 号停点 1.5 米的位置。两人停步转向彼此，01 号挥手，02 号点头。问候结束后，01 号选择下一目的地，02 号沿自己的路线离开。跟随 01 时，镜头会同时框住两人。01 号复用 `Wave`，02 号在待机上叠加一次头部点头。跟拍及暂停可以观察动作细节。[问候实测截图](renders/NEXCIV_Web_Market_Greeting.jpg)。

02 号角色包约 0.86 MB，在镜头或 01 号接近商铺时下载。角色包请求失败时，01 号正常停留并选择下一目的地。相遇属于网页演示行为。

网页版复用三个角色的网格、骨架、`Walk` 和 `Idle`，按各自步幅同步位移与步频。路线标记为演示行为。[01 号角色库](../../tripo/citizen-01-v1/motion/) · [02 号角色库](../../tripo/builder-02-v1/motion/) · [03 号角色库](../../tripo/researcher-03-v1/motion/) · [南线跟拍、过街和到店截图](renders/NEXCIV_Web_Walk_Preview.jpg)。

南线分块基线在本机 Edge、390 × 844 模拟触屏、8 Mbps 和 80 ms 延迟下测量，各使用两次冷缓存导航。计时从打开页面到 01 号路线进度首次大于零。

| 指标 | 拆分前 | 拆分后 |
| --- | ---: | ---: |
| 首次见到 Agent 移动，两次平均 | 14.4 秒 | 7.6 秒 |
| 首屏 GLB 经 HTTP 压缩后的实际传输量 | 9.26 MB | 2.60 MB |

传输量统计街区和角色 GLB。生产构建连同 JavaScript 的首载体积需要另行测量。

已在 Edge 桌面窗口验证两名 Agent 的独立行走、跟拍切换、03 号到达议会大厅及折返。在 390 × 844 触屏模拟窗口验证视角选择和减少动态效果。Blender 重新导入南侧底包和北区 GLB 后，北线 157 个点均命中地面，支撑高度最大误差 2.5 厘米。检查 36 个白线采样点和 11 个沥青间隔，标高一致。手机真机性能仍需实测。

在仓库根目录用 Blender 5.3 重新导出网页模型与路线。

```powershell
blender -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/export_nexciv_walk_preview.py
```

只需重新导出北区时，在命令末尾加 `-- --chunk governance`。把角色库的 `CIVRUM_Builder_02.glb` 和 `CIVRUM_Researcher_03.glb` 分别复制到 `apps/web/public/nexciv-walk/agent-02.glb` 和 `apps/web/public/nexciv-walk/agent-03.glb`。[02 号角色库](../../tripo/builder-02-v1/motion/) · [03 号角色库](../../tripo/researcher-03-v1/motion/)。

安装 Pillow 后，在仓库根目录用现有工具重新打包角色贴图。

```powershell
python -c "import sys; from pathlib import Path; sys.path.insert(0, 'scripts'); from prepare_civrum_hi3d import texture_copy; texture_copy(Path('art-direction/tripo/citizen-01-v1/motion/CIVRUM_Citizen_01.glb'), Path('apps/web/public/nexciv-walk/agent-01.glb'), 512)"
```

## 城区道路标线

[打开道路修正版](NEXCIV_World_300m_Roads.blend) · [标线前后对比](renders/NEXCIV_Roads_Comparison.jpg) · [行人视角](renders/NEXCIV_Roads_Near.png)。117 段直路的车道线和斑马线直接使用路面网格中的材质分区。四条会被斜向坡道切到的白线已按坡道范围让位。水景步道口在两侧坡道之间均布七条白线。

从保存的场景重开后，1,365 个白线采样点都命中正确的路面材质。两段道路导出为 GLB 后重新导入，沥青和白线仍处于同一标高。角色走查也已复验。浏览器端整城缩放与移动端显示是后续游戏集成的验收项。

```powershell
blender -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/build_nexciv_road_markings.py -- --save --render
```

## Nexus 中央广场

[打开中央广场修正版](NEXCIV_World_300m_Plaza.blend) · [同机位前后对比](renders/NEXCIV_Plaza_Comparison.jpg)。中央雕塑和直径 16.5 米的石材镶嵌共用圆心 `(0, -12.15)`。十六组放射纹和两道金色环线拼在同一个铺装面上。外圈距台阶最近处 0.70 米，南侧引导线分列入口字标两侧。

场景基于北岸圆塔版。Blender 5.3 重开文件后，沿圆环和放射纹采样的 1,152 个点均命中同一铺装高度。后续重建湖畔场景也会使用这套铺装。

```powershell
blender -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/build_nexciv_plaza_patch.py -- --save --render
```

## 北岸圆塔

[打开 NEXCIV 湖畔场景](NEXCIV_World_300m_Waterfront.blend)。北岸原圆塔地块位于 `(-83, 145.2)`，新版约 36.7 米高。弧形塔冠朝向湖岸，屋面设独立种植池与座椅。楼层压边、深色立柱上的细金线、内退玻璃和琥珀色窗灯可分别调整。首层雨棚有 NEXCIV 字样，透过门厅玻璃可见接待台和吊灯。

[原塔与新版对比](renders/NEXCIV_Waterfront_Comparison.jpg) · [全城俯视](renders/NEXCIV_Waterfront_Overview.png) · [入口近景](renders/NEXCIV_Waterfront_Lobby.png) · [Corner Market 屋顶招牌](renders/NEXCIV_Waterfront_Market.png)。

新版共 18,802 个三角面。Blender 5.3 已重开验证场景，原共享圆塔仍用于其他六个地块。Corner Market 的可编辑屋顶文字也同步为 NEXCIV。依次重建街角商铺与北岸圆塔可复现当前场景。

```powershell
blender -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/build_civrum_corner_market.py -- --save
blender -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/build_nexciv_waterfront_tower.py -- --save --views lobby skyline crown market overview before
```

## Nexus 东南街角商业楼

[打开街角商业楼场景](CIVRUM_World_300m_Corner_Market.blend)。场景使用已确认的黑金暖黄昏，在 Nexus 东南侧的原商业楼地块放置五层 Corner Market。首层和二层形成连续街墙，三至五层向内退台。金色压边、切角入口和 NEXCIV 屋顶招牌在 `19 | Corner Market` 集合中可单独编辑。

[建模阶段的同机位对比](renders/CIVRUM_Corner_Market_Comparison.jpg) · [更新后的 NEXCIV 屋顶招牌](renders/NEXCIV_Waterfront_Market.png) · [入口细节](renders/CIVRUM_Corner_Market_Detail.png)。

入口相对切角外轮廓后退 1.13 米。Blender 5.3 重新打开验证后，从南面和西面各抽样一条水平视线，玻璃后分别有约 6.60 米与 4.92 米进深。含更新后招牌的样板共 289,564 个三角面。原广告牌商业楼的其余 12 个实例沿用共享资产。

```powershell
blender -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/build_civrum_corner_market.py -- --save --views detail street before overview
```

## 黑金暖黄昏

[打开黑金暖黄昏场景](CIVRUM_World_300m_Gold_Dusk.blend)。夕阳照亮建筑朝光面，深蓝湖面和石墨灰街道衬托暖色橱窗。中央 Nexus 顶部、广场指路线与退台办公楼的局部收边使用技术黄 `#F0B90B`。园艺商铺用较柔和的金属色，入口雨棚的暖光延伸到人行道。

[前后对比](renders/CIVRUM_Gold_Dusk_Comparison.jpg) · [全城俯视](renders/CIVRUM_Gold_Dusk_Overview.png) · [商铺街景](renders/CIVRUM_Gold_Dusk_Street.png)。对比沿用上一版黄昏的镜位、曝光和第 120 帧。可在仓库根目录重建此 Blender 版本。

```powershell
blender -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/build_civrum_shop_dusk.py -- --gold --save --views overview street
```

## 湖畔商街黄昏版

[打开黄昏场景](CIVRUM_World_300m_Dusk.blend) 后，相机位于南侧园艺商铺前。场景沿用上一版的模型和镜位，把太阳高度从 25° 调到 10°。入口雨棚的两盏向下照明覆盖门前铺地，招牌、前排货架和二楼分别控制亮度；屋顶天窗仍能看见二层。可在 `18 | Dusk practical lighting` 集合调整新增灯具。

28 栋同源沿街商铺复用原网格和贴图，按窗带高度、窗面颜色和位置控制暖光。99 盏路灯的光源跟随灯头，按三种灯型共享灯具数据。中央广场与议会入口有局部投光，蓝色水景保留在广场水池一带。

[街景与俯视原光照对比](renders/CIVRUM_Dusk_Comparison.jpg) · [1920 × 1080 街景](renders/CIVRUM_Dusk_Street.png) · [2560 × 1440 俯视](renders/CIVRUM_Dusk_Overview.png)。两组镜位均使用第 120 帧。此版本供 Blender 美术评审。

```powershell
blender -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/build_civrum_shop_dusk.py -- --save --views street overview
```

## 南侧园艺商铺

[打开南侧商铺样板场景](CIVRUM_World_300m_South_Shop.blend)。打开时相机朝向园艺店正门。样板位于南侧中央入口以东的第一栋低楼，沿用走查版的 40 号地基、朝向和傍晚光照。在大纲展开 `16 | South garden shop`，可分别编辑石座与柱、窗框、门廊、屋面、种植池和室内陈列。原 Hi3D 的屋顶多肉沿用原贴图，金属收边、磨砂石材与透景玻璃分别着色。

| 观察位置 | 原模型 | 精修样板 |
| --- | --- | --- |
| 全城俯视 | [全城原图](renders/CIVRUM_South_Shop_Overview_Before.png) | [全城样板位置](renders/CIVRUM_South_Shop_Overview_After.png) |
| 屋顶斜俯视 | [原屋顶](renders/CIVRUM_South_Shop_Roof_Before.png) | [采光天窗和种植池](renders/CIVRUM_South_Shop_Roof_After.png) |
| 临街人眼高度 | [原橱窗](renders/CIVRUM_South_Shop_Street_Before.png) | [内凹门廊和园艺陈列](renders/CIVRUM_South_Shop_Street_After.png) |

[街景与屋顶并排对比](renders/CIVRUM_South_Shop_Comparison.jpg) 中，每对图使用相同相机、画幅、曝光与第 120 帧。门平面在橱窗后方 1.10 米。穿过正面橱窗的水平抽样射线在玻璃后 4.97 米处遇到室内陈列区的背墙。天窗下方连通二层。Blender 5.3 重开验证时，整栋样板含保留植物、文字及倒角共 183,333 个三角面，原商业楼为 396,036 个。其余 28 个同源商铺仍显示原资产。这里统计的是离线 Blender 场景。

在仓库根目录重建、重新打开验证并渲染三组对比。

```powershell
blender -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/build_civrum_south_shop.py -- --save --views street roof overview
```

## 行人走查版

打开 [CIVRUM_World_300m_Walkthrough.blend](CIVRUM_World_300m_Walkthrough.blend)，按空格从第 33 帧开始跟拍。01 号从中央广场出发，经斑马线和水景步道，转入公共建设中心前庭。全程约 128.8 米，30 帧/秒，第 4950 帧停在台阶前。时间线标记对应出发、过街、转向、到达前庭、工人查看面板和到达台阶。

八名居民各自链接 [角色动作库](../../tripo/)，在湖畔场景中使用本地角色对象与 NLA 动作轨。原静态居民集合可在大纲里恢复显示。02 号建设工人先步行靠近面板，转身后低头并抬右手。沿线路缘有坡道，水景间补了连续铺面和导向牌。入口前庭增加石材铺装，玻璃后能看到有真实进深的门厅凹位、暖光与接待台。跟拍停在入口外。

| 机位 | 渲染 |
| --- | --- |
| 同机位全城俯视 | [湖岸与街区](renders/CIVRUM_Walkthrough_Overview.png) |
| 中央广场行人高度 | [广场出发](renders/CIVRUM_Walkthrough_Nexus_Plaza.png) |
| 东侧水景横道 | [角色过街](renders/CIVRUM_Walkthrough_Crossing.png) |
| 公共建设中心行人高度 | [前庭与台阶](renders/CIVRUM_Walkthrough_Public_Works.png) |
| 面板侧前方 | [建设工人查看面板](renders/CIVRUM_Walkthrough_Work_Panel.png) |

走查版与原场景同目录，依赖原有相对资产链接及八个角色目录下的 `motion/*.blend`。在仓库根目录重建和验证。

```powershell
blender -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/build_civrum_lakeside_walk.py -- --save
blender -b --factory-startup --disable-autoexec art-direction/world-upgrade-v1/lakeside-study/CIVRUM_World_300m_Walkthrough.blend --python-exit-code 2 -P scripts/verify_civrum_lakeside_walk.py
blender -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/build_civrum_lakeside_walk.py -- --views overview plaza crossing entrance panel
```

在 Blender 5.3 重新打开走查版，八套骨架和相对资产链接均可加载。沿路线每隔五帧检查 48 厘米宽的通行范围，采样点无障碍物侵入。过街及入口抽查帧的支撑脚离地或下陷量最大约 1.1 厘米。转身由身体动画衔接到场景朝向，结束后继续向南行走。

## 湖畔美术母版

用 Blender 5.3 打开 [CIVRUM_World_300m_Lakeside.blend](CIVRUM_World_300m_Lakeside.blend)。随场景移动时，一并带上 [landmark-masters/buildings](../landmark-masters/buildings/)、[Hi3D](../../hi3d/) 各资产子目录中的 Blender 资产库和本目录的 [assets](assets/)，并保持相对位置。贴图内嵌在各自的 Blender 文件里。

城市地块为 300 × 300 米，+Y 向北。湖位于北边界之外，湖面 Z = −1.34 米。滨水步道沿 Y ≈ 165 米贯通，两个栈桥和自然岸坡可独立编辑。西南侧 25° 的斜阳照亮临街立面，冷色天空为阴影补光。湖面纹理由颜色属性、噪声凹凸和反射节点生成。

城区外的坡地和远岸林带随地形起伏，步道按地表贴合。树木复用六套树冠网格，松树、阔叶树和秋色树穿插成片。湖岸用碎石和深浅水色衔接，码头设有系缆桩、分段栏杆、遮阳架和四艘停靠船。南入口两块空地补成口袋花园，七栋退台办公楼使用三种屋顶造型。

注册中心链接 [独立彩色资产库](assets/CIVRUM_Citizen_Registry.blend)。现有建筑网格采用重新绘制的立面贴图，招牌独立成面。东南建设区从北侧步道进入公共建设中心，南侧货运入口沿实体缓坡进入施工区。塔吊底座设在场内车道东侧，脚手架、预制件和材料架分别贴地就位。

公共建设中心的穹顶采用独立的玻璃三角面和金属杆件，屋顶平台补了铺面和成组花槽。塔吊沿施工场地转向，从全城机位看，吊臂与穹顶之间留出空隙。[建设区同机位局部对比](renders/CIVRUM_Public_Construction_Overview_Comparison.jpg) 的左右图均以 4K 渲染并裁切。

入口的台阶、两侧梯梁和上下两道檐口收边使用独立网格。踏面水平，檐口沿原造型连续过渡。穹顶框条截面已收窄。[入口近景同机位对比](renders/CIVRUM_Public_Construction_Surface_Comparison.jpg)。

| 固定机位 | 渲染 |
| --- | --- |
| 全城俯视，观察广场、北岸与街区长影 | [全城](renders/CIVRUM_Lakeside_Overview.png) |
| 湖畔行人视角，观察木栈桥、水纹和栏杆 | [湖畔](renders/CIVRUM_Lakeside_Walk.png) |
| 普通街道视角，检查路面与背光立面 | [街道](renders/CIVRUM_Street_Golden_Hour.png) |
| 西北湖畔摩天楼，检查首层入口和天际线 | [摩天楼](renders/CIVRUM_Lakeside_Tower.png) |
| 南入口，观察两栋商业楼和盆栽 | [商业街](renders/CIVRUM_South_Commercial_Corner.png) |
| 东南工地，观察塔吊和围挡 | [塔吊](renders/CIVRUM_Construction_Crane.png) |
| 西侧水景街道，观察喷泉、行道树和塔间连廊 | [水景街道](renders/CIVRUM_West_Garden_Avenue.png) |
| 西码头抬高机位，检查停靠船、岸线和对岸林带 | [码头](renders/CIVRUM_Lakeside_Marina.png) |
| 公民注册中心街景，检查贴图、招牌和入口 | [注册中心](renders/CIVRUM_Citizen_Registry.png) |
| 公共建设中心北入口，检查招牌和步道衔接 | [建设中心](renders/CIVRUM_Public_Construction_Entrance.png) |

[同机位前后对照](renders/CIVRUM_Lakeside_Comparison.jpg) 左侧是远景精修前，右侧是精修后。两张图使用相同的相机位置、朝向和焦距。

渲染使用 Cycles 并降噪。全城俯视为 3840 × 2160，最高 64 采样。其他机位为 1920 × 1080，最高 36 采样。`07 | Lakeside atmosphere` 汇集湖畔可编辑内容。集合 08–10 放置首批 Hi3D 楼、树和工地塔吊。集合 11–14 分别存放沿街建筑、水景和剧场、公共露台、静态车辆。56 个沿街地块的旧体块和外立面均保留在原集合中并隐藏。中央广场、四处地标、路网和八名原有角色沿用母版位置。

东西主街用七栋 Hi3D 塔楼和七栋退台办公楼围合视野，西侧设空中连廊。中央辐射街区和南入口采用较低的商铺。西南社区的六层露天剧场面向中央舞台。东西两侧各有一条喷泉步道，东侧分成两个水池，为原有绿地留出空间。城区用咖啡亭、遮阳桌、花池和盆栽构成步行停留点。沿街车辆仅用于 Blender 场景比例展示。

## Hi3D 街区资产

原始 GLB 分开归档。场景链接独立 Blender 资产库，沿用原纹理布局并简化网格。商业楼和塔吊的贴图为 4K，两棵盆栽为 2K。楼顶广告牌沿用源 GLB 的图案。

| 资产目录 | 市内位置 | 实例数 | 共享源网格三角面 |
| --- | --- | ---: | ---: |
| [湖畔摩天楼](../../hi3d/lakeside-tower-v1/) | 东西两翼和北岸 | 7 | 1,967,990 |
| [屋顶花园商业楼](../../hi3d/garden-roof-retail-v1/) | 中心支路、南入口和外街 | 29 | 396,036 |
| [屋顶广告牌商业楼（原 Untitled）](../../hi3d/billboard-commercial-v1/) | 临街转角和北岸 | 13 | 384,674 |
| [绿叶盆栽](../../hi3d/green-planter-tree-v1/) | 步道、社区院落和商业露台 | 80 | 199,886 |
| [秋叶盆栽](../../hi3d/autumn-planter-tree-v1/) | 喷泉、街角和公共活动区 | 18 | 199,607 |
| [塔式起重机](../../hi3d/tower-crane-v1/) | 东南施工围挡内 | 1 | 425,482 |

在 Blender 5.3 重新打开场景后，可用下面的命令检查全部楼位、道路占地、相对资产链接和内嵌贴图。建筑包围盒在水平面上的投影须彼此分离，并避开车道和模块化人行道。此处的实例数用于离线美术场景统计。

```powershell
& 'G:/blender/blender.exe' -b --factory-startup --disable-autoexec art-direction/world-upgrade-v1/lakeside-study/CIVRUM_World_300m_Lakeside.blend --python-exit-code 2 -P scripts/verify_civrum_lakeside.py
```

在仓库根目录用以下命令重建本样板。附加 `-- --draft` 时只生成临时的 960 × 540 校样。

```powershell
& 'G:/blender/blender.exe' -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/build_civrum_lakeside.py
```

附加 `-- --views overview tower` 可仅重渲摩天楼和全景。附加 `-- --prepare-tower` 可从存档 GLB 重建摩天楼资产库。

其余五个库可用 `python scripts/prepare_civrum_hi3d.py <Blender.exe> <gltfpack或cli.js>` 重建，依赖 Pillow 与 gltfpack 0.25。场景重渲可用 `-- --views overview shops crane`。
