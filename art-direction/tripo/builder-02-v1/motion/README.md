# 02 号建设工人动作样板

[街景录像](Builder_02_Street.mp4) · [Blender 工程](CIVRUM_Builder_02.blend) · [动画 GLB](CIVRUM_Builder_02.glb)

E6-07 近景角色试件。工人和 03 号研究员共用 20 根骨骼的层级、动作生成代码和街景路线。关节按工人的肩宽、髋高和靴子位置重新定位，摆臂幅度为侧腰工具袋留出间隙。戴帽站立的绑定高度设为 1.72 米。安全帽和护目镜绑定头骨，腰带、搭扣和工具袋绑定骨盆。较长的黄色袋子略向前、向外抬起，给工装裤侧袋留出抬腿空间。

| 动作 | 时长 | 接入方式 |
| --- | --- | --- |
| Idle | 3.0 秒 | 循环待机 |
| Walk | 1.2 秒 | 原地循环，由宿主沿地面平移约 0.803 米/秒 |
| TurnLeft90 / TurnRight90 | 各 1.0 秒 | 分两次迈步转身，结束时将 90° 朝向交给宿主 |

GLB 面朝 +Z，绑定姿势下脚底位于 Y=0。模型有 21,371 个三角面，每顶点最多受 4 根骨骼影响。工装配色、反光条、护目镜、眼睛和靴子共用一个材质和一张内嵌的 1024 × 1024 底色贴图。源文件来自用户提供的 `construction worker 3d model.glb`，SHA-256 为 `286749d7eeb5c087b60636dd940c2e4523bd720907db3ea202ea20a60eae5adf`。

## 预览

在安装了仓库依赖的项目根目录运行下面的命令，然后打开[建设工人街景预览](http://127.0.0.1:8765/art-direction/tripo/researcher-03-v1/motion/preview.html?character=builder)。浏览器启用减少动态效果时，可用播放按钮启动。

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

约 26 秒的录像取自 Chrome 实际播放的 Three.js 场景。工人从广场步行至 Agent 中心台阶前，在途中完成两次转向。

## 重建和验证

在仓库根目录使用 Blender 5.3。重建需要上述原始模型。验证只需交付目录中的 Blender 工程和 GLB。

```powershell
$model = 'art-direction/tripo/builder-02-v1/construction worker 3d model.glb'
$out = 'art-direction/tripo/builder-02-v1/motion'
& 'G:/blender/blender.exe' -b --factory-startup --python-exit-code 2 -P tools/blender/rig_builder.py -- $model $out
& 'G:/blender/blender.exe' -b --factory-startup --python-exit-code 2 -P tools/blender/verify_builder_motion.py -- $out
```

Blender 逐帧检查了四段动作共 190 帧，包括安全帽和腰带的刚性跟随、手与工具袋、袋底与大腿区裤料、左右小腿区裤料。随后重新导入 GLB 核对蒙皮、贴图和片段时长。Chrome 完整步态和转向片段的采样中，支撑脚锚点最大漂移约 0.19 毫米，摆动脚最高离地约 10.9 厘米。验收范围为单个近景角色。
