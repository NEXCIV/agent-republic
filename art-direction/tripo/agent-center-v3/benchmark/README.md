# Agent 中心街景样板

E6-07 美术精修试件。以用户提供的 Tripo 三视图导出 `agent center 3d model.glb` 为底稿，源文件 SHA-256 为 `34c31665b0039c3c6d94bc06e685e2163f0c865946399029da4f50dd25173391`。石材、窗、紫色饰带和金属件使用独立 PBR 材质。正面保留门廊和台阶，补做了深色玻璃、金属窗框、双开门、雨棚灯具和招牌。

| 文件 | 用途 |
| --- | --- |
| [Blender 工程](CIVRUM_Agent_Center_Street.blend) | 可编辑材质、入口、窗框、灯具及招牌 |
| [街景 GLB](CIVRUM_Agent_Center_Street.glb) | 静态网页渲染，按材质合批 |
| [实机浏览器截图](Review_WebGL.png) | Chrome WebGL 测试场景，03 号白模按 1.68 米摆放以核对尺度 |

建筑外包围盒为 7.00 × 6.74 × 5.06 米，依次为宽、高、深。以地基中心为原点，glTF 的 Y 为高度，最低点 Y=0，入口朝 -Z。按项目的 CORE 坐标 `[9, 0, 9]` 放置后，入口面朝广场路点 P12。双开门尺寸约 1.71 × 2.06 米，门槛距地 0.24 米。

Blender 5.3 已重新打开工程并重新导入 GLB。源文件为 46,675 个三角面，精修导出为 34,762 个三角面，9 个材质绘制单元，文件大小 1,066,564 字节。无头 Chrome 中使用项目的 Three.js 和 GLTFLoader 进行静态渲染，从 P12、离地 1.20 米向建筑发射的射线命中正面玻璃门。测试场景由建筑、地面和人物比例参考组成。角色绑骨、动作及完整街区帧率属于后续验收。

## 重建

在仓库根目录使用 Blender 5.3。传入与上述哈希匹配的用户源文件，并为招牌提供支持中文的字体。

```powershell
& 'G:/blender/blender.exe' --background --factory-startup --python-exit-code 2 --python tools/blender/refine_agent_center.py -- 'art-direction/tripo/agent-center-v3/agent center 3d model.glb' art-direction/tripo/agent-center-v3 art-direction/tripo/agent-center-v3/benchmark --font 'C:/Windows/Fonts/Dengb.ttf'
```
