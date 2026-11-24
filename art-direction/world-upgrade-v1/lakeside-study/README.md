# CIVRUM 湖畔城市 · E6-07 氛围样板

用 Blender 5.3 打开 [CIVRUM_World_300m_Lakeside.blend](CIVRUM_World_300m_Lakeside.blend)。随场景移动时，一并带上 [landmark-masters/buildings](../landmark-masters/buildings/) 和 [Hi3D](../../hi3d/) 各资产子目录中的 Blender 资产库，并保持相对位置。贴图内嵌在各自的 Blender 文件里。

城市地块为 300 × 300 米，+Y 向北。湖位于北边界之外，湖面 Z = −1.34 米。滨水步道沿 Y ≈ 165 米贯通，两个栈桥和自然岸坡可独立编辑。场景用 18.5° 的暖色西斜阳照明，冷色天空补光。湖面纹理由颜色属性、噪声凹凸和反射节点生成。

| 固定机位 | 渲染 |
| --- | --- |
| 全城俯视，观察广场、北岸与街区长影 | [全城](renders/CIVRUM_Lakeside_Overview.png) |
| 湖畔行人视角，观察木栈桥、水纹和栏杆 | [湖畔](renders/CIVRUM_Lakeside_Walk.png) |
| 普通街道视角，检查路面与背光立面 | [街道](renders/CIVRUM_Street_Golden_Hour.png) |
| 西北湖畔摩天楼，检查首层入口和天际线 | [摩天楼](renders/CIVRUM_Lakeside_Tower.png) |
| 南入口，观察两栋商业楼和盆栽 | [商业街](renders/CIVRUM_South_Commercial_Corner.png) |
| 东南工地，观察塔吊和围挡 | [塔吊](renders/CIVRUM_Construction_Crane.png) |

渲染使用 Cycles，1920 × 1080，最高 36 采样并降噪。Blender 中可通过 `07 | Lakeside atmosphere` 调整岸线、湖面、步道、植被、灯光和机位。西北角摩天楼位于 `08 | Lakeside tower`，两栋新商业楼和盆栽位于 `09 | South commercial corner`，塔吊位于 `10 | Construction crane`。三个被替换地块的原建筑体块及外立面已隐藏。

## Hi3D 街区资产

原始 GLB 分开归档。场景链接独立 Blender 资产库，沿用原纹理布局并简化网格。商业楼和塔吊的贴图为 4K，两棵盆栽为 2K。楼顶广告牌沿用源 GLB 的图案。

| 资产目录 | 市内位置 | 高度 | 场景三角面 |
| --- | --- | ---: | ---: |
| [屋顶花园商业楼](../../hi3d/garden-roof-retail-v1/) | 南入口西侧 | 10.3 m | 396,036 |
| [屋顶广告牌商业楼（原 Untitled）](../../hi3d/billboard-commercial-v1/) | 南入口东侧 | 18 m | 384,674 |
| [绿叶盆栽](../../hi3d/green-planter-tree-v1/) | 西侧街角 | 3.45 m | 199,886 |
| [秋叶盆栽](../../hi3d/autumn-planter-tree-v1/) | 东侧街角 | 3.65 m | 199,607 |
| [塔式起重机](../../hi3d/tower-crane-v1/) | 东南施工围挡内 | 22 m | 425,482 |

已在 Blender 5.3 重新打开场景，对比道路、地标、沿街建筑和角色站位共 268 个对象的变换。三栋链接地标均可读取内嵌 8K 底色贴图。新版包含 1,264 个湖面四边形，南侧道路与既有主街道端点对齐。

在仓库根目录用以下命令重建本样板。附加 `-- --draft` 时只生成临时的 960 × 540 校样。

```powershell
& 'G:/blender/blender.exe' -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/build_civrum_lakeside.py
```

附加 `-- --views overview tower` 可仅重渲摩天楼和全景。附加 `-- --prepare-tower` 可从存档 GLB 重建摩天楼资产库。

其余五个库可用 `python scripts/prepare_civrum_hi3d.py <Blender.exe> <gltfpack或cli.js>` 重建，依赖 Pillow 与 gltfpack 0.25。场景重渲可用 `-- --views overview shops crane`。
