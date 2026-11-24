# CIVRUM 湖畔城市 · E6-07 氛围样板

用 Blender 5.3 打开 [CIVRUM_World_300m_Lakeside.blend](CIVRUM_World_300m_Lakeside.blend)。随场景移动时，一并带上相邻的 [landmark-masters/buildings](../landmark-masters/buildings/) 目录并保持相对位置。三栋相连建筑的高精度主贴图内嵌在各自的 Blender 文件里。

城市地块为 300 × 300 米，+Y 向北。湖位于北边界之外，湖面 Z = −1.34 米。滨水步道沿 Y ≈ 165 米贯通，两个栈桥和自然岸坡可独立编辑。场景用 18.5° 的暖色西斜阳照明，冷色天空补光。湖面纹理由颜色属性、噪声凹凸和反射节点生成。

| 固定机位 | 渲染 |
| --- | --- |
| 全城俯视，观察广场、北岸与街区长影 | [全城](renders/CIVRUM_Lakeside_Overview.png) |
| 湖畔行人视角，观察木栈桥、水纹和栏杆 | [湖畔](renders/CIVRUM_Lakeside_Walk.png) |
| 普通街道视角，检查路面与背光立面 | [街道](renders/CIVRUM_Street_Golden_Hour.png) |

三张图使用 Cycles，1920 × 1080，最高 36 采样并降噪。Blender 中可通过 `07 | Lakeside atmosphere` 调整岸线、湖面、步道、植被、当期灯光和三个机位。新建筑可以继续按各自地块坐标放置。现有普通街区沿用街道模块，画面用于验收布局和光影。

已在 Blender 5.3 重新打开场景，对比道路、地标、沿街建筑和角色站位共 268 个对象的变换。三栋链接地标均可读取内嵌 8K 底色贴图。新版包含 1,264 个湖面四边形，南侧道路与既有主街道端点对齐。

在仓库根目录用以下命令重建本样板。附加 `-- --draft` 时只生成临时的 960 × 540 校样。

```powershell
& 'G:/blender/blender.exe' -b --factory-startup --disable-autoexec --python-exit-code 2 -P scripts/build_civrum_lakeside.py
```
