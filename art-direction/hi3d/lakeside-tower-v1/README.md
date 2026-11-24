# CIVRUM 湖畔摩天楼

| 文件 | 用途 |
| --- | --- |
| [Hi3D 原始 GLB](Hi3D_现代豪华摩天大楼3D模型_allparts_20261125_000239.glb) | 用户提供的原始导出，保留文件名、几何和贴图 |
| [Blender 资产库](CIVRUM_Lakeside_Tower.blend) | 独立建筑集合，原点位于塔基中心，入口朝 −Y，塔身高度归一为 1 单位 |

源文件由 Hi3D 导出，包含 1 个网格、1 个 PBR 材质、1,967,990 个三角面，以及两张 8192 × 8192 贴图（底色与金属度/粗糙度）。原始 GLB 的 SHA-256 为 `e1efe02b01754661faf5da2dfa5692c1979707477865e7ec846863b450cbce6b`。Blender 库内嵌两张贴图。

在 300 米湖畔场景中，楼体底部中心为 `(-83, 145.2, 0.185)` 米，实例高 37 米，含圆形平台的占地约 22.4 × 22.6 米。入口朝南接北侧横街。查看 [场景](../../world-upgrade-v1/lakeside-study/CIVRUM_World_300m_Lakeside.blend) 和 [街面渲染](../../world-upgrade-v1/lakeside-study/renders/CIVRUM_Lakeside_Tower.png)。

已重开世界文件检查相对路径、贴图、塔基高度和道路占地。塔基顶面与塔楼底面贴合，楼体平面包围盒与既有道路全段无重叠。
