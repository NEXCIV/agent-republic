# CIVRUM 01 号城市居民 · 身体动作

[动作预览（正面与侧前方）](Citizen_01_Motion.mp4) · [带动作的 GLB](CIVRUM_Citizen_01.glb) · [可编辑的 Blender 工程](CIVRUM_Citizen_01.blend)

使用用户提供的蓝绿色夹克、米色连帽衫版本。19 个原始网格共用一套 20 骨的人形骨架，保留原有 UV、19 张内嵌底色贴图和 8,500 个三角面。按 1.70 米设定绑定身高，脚底为原点高度，导出的角色面向 glTF +Z。外套的肩袖随手臂运动，头发和双眼跟随头部。

| 片段名 | 时长 | 播放方式 |
| --- | --- | --- |
| `Idle` | 3.0 秒 | 循环，轻微呼吸和头部摆动 |
| `Walk` | 1.2 秒 | 原地循环，宿主沿路线移动。每周期 0.952 米，约 0.793 米/秒 |
| `TurnLeft90` / `TurnRight90` | 各 1.0 秒 | 播放一次，分两步转身，结束时由宿主接管新朝向 |
| `Wave` | 2.4 秒 | 右臂抬起，手腕来回摆动后回到待机，可一次播放 |

基础动作复用项目中 02、03 号人物使用的动作生成器，关节重新对准 01 号人物的肩、肘、腕和鞋底。挥手是本次新增的身体动作，手指沿用原模型的自然弯曲。网页预览使用 Three.js 加载交付的 GLB，并通过 AnimationMixer 播放五段动作。

## 复核

Blender 5.3 逐帧检查五个片段共 263 个采样帧，覆盖 91 对相邻衣片顶点、支撑脚落地，以及双手与头、衣身、长裤和侧袋的碰撞。重新导入 GLB 后核对片段时长、骨骼、三角面和每个顶点的权重，每个顶点最多受四根骨骼影响。19 张贴图的内嵌图像数据与源文件逐张哈希匹配。

以下命令在仓库根目录执行。重建时传入 SHA-256 为 `1ba4a1b2ae863d2f5cc473b914921ebe14936e9f63dc7ad41ecf975063d77b22` 的原始 GLB。

```powershell
$source = "$env:USERPROFILE/Downloads/tripo_convert_8c533494-4b6d-4265-8189-89f6d7bfc6e0.glb"
$out = 'art-direction/tripo/citizen-01-v1/motion'
& 'G:/blender/blender.exe' -b --factory-startup --python-exit-code 2 -P tools/blender/rig_citizen.py -- $source $out
& 'G:/blender/blender.exe' -b --factory-startup --python-exit-code 2 -P tools/blender/verify_citizen_motion.py -- $source $out
```
