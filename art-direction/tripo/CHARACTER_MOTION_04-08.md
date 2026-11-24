# CIVRUM 04–08 号角色动作

[Blender 动作姿态预览](CIVRUM_Motion_04-08.jpg)

五个角色沿用 01–03 号的 20 骨骼命名。各自按原模型的比例调整关节位置和步幅。06 号围裙前片留出迈步余量，05 和 07 号背包随上身移动，08 号腰包随骨盆移动。GLB 内嵌原配色贴图，每个顶点最多受四根骨骼影响。

| 角色 | Blender | 动画 GLB | 三角面 | 身高 | 每个步行周期 |
| --- | --- | --- | ---: | ---: | ---: |
| 04 创意青年 | [工程](creator-04-v1/motion/CIVRUM_Creator_04.blend) | [模型](creator-04-v1/motion/CIVRUM_Creator_04.glb) | 52,940 | 1.70 m | 0.850 m |
| 05 城市居民 | [工程](citizen-05-v1/motion/CIVRUM_Citizen_05.blend) | [模型](citizen-05-v1/motion/CIVRUM_Citizen_05.glb) | 54,648 | 1.65 m | 0.792 m |
| 06 商业服务 | [工程](service-06-v1/motion/CIVRUM_Service_06.blend) | [模型](service-06-v1/motion/CIVRUM_Service_06.glb) | 52,360 | 1.66 m | 0.531 m |
| 07 创意居民 | [工程](creator-07-v1/motion/CIVRUM_Creator_07.blend) | [模型](creator-07-v1/motion/CIVRUM_Creator_07.glb) | 52,426 | 1.64 m | 0.738 m |
| 08 城市技术员 | [工程](technician-08-v1/motion/CIVRUM_Technician_08.blend) | [模型](technician-08-v1/motion/CIVRUM_Technician_08.glb) | 55,420 | 1.68 m | 0.740 m |

## 播放

在 Blender 的动作编辑器选择片段。GLB 在绑定姿势下脚底位于 Y＝0，面朝 +Z。

| 片段 | 时长 | 播放方式 |
| --- | ---: | --- |
| `Idle` | 3.0 s | 循环待机 |
| `Walk` | 1.2 s | 原地循环，由场景驱动平移。步行一个完整周期的距离记录在骨架节点的 `walk_stride_m` 中 |
| `TurnLeft90` | 1.0 s | 左转 90° |
| `TurnRight90` | 1.0 s | 右转 90° |

两段转向的偏航写在骨盆上。播完转向后将该角度应用到场景角色根节点，再切换到待机或步行。

## 重建与验证

将原始带贴图 GLB 放在各角色目录内。准确文件名见 [构建脚本](../../tools/blender/rig_ensemble.py) 中的 `CAST`。在项目根目录运行下列命令，生成到临时目录方便对比。

```powershell
blender -b --factory-startup --disable-autoexec --python-exit-code 2 -P tools/blender/rig_ensemble.py -- --output "$env:TEMP/civrum-roles"
```

五份 Blender 工程均已打开验证。五份 GLB 均已重新导入 Blender，检查了骨骼、权重归一化、动作名称和时长，并比对了导出前后的原配色贴图。动作姿态预览来自交付工程。
