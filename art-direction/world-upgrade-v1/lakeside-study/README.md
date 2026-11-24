# CIVRUM 湖畔城市 · E6-07 氛围样板

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
