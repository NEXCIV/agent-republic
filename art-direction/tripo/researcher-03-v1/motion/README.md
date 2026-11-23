# 03 号研究员动作样板

[直接播放街景录像](Researcher_03_Street.mp4) · [Blender 工程](CIVRUM_Researcher_03.blend) · [带骨骼与动作的 GLB](CIVRUM_Researcher_03.glb)

E6-07 近景角色试件。研究员从中央广场出发，沿 District 01 的 P0、P4、P8、P12 路点步行，在 P12 转身朝向 Agent 中心，再往前走 2.30 米，停在台阶前。最后一段用于观察门口尺度。录像来自本机 Chrome 实际加载角色和建筑 GLB 的 WebGL 画面，时长约 26 秒。页面和录像均为 DEMO。

## 资产

人物来自用户提供的 `scientist boy 3d model.glb`。源文件 SHA-256 为 `017f63173066ea4d422a9a44e184f4a6b308ee950aa5011bf0045f2068eb6b28`。在原有造型上增加了骨骼、蒙皮、眼部细节和按三视图配色的顶点色。白大褂前片留出抬腿余量。眼镜和头发跟随头部，耳机跟随胸部，衣摆由骨盆和左右大腿共同驱动。

角色在绑定姿势下高 1.68 米，GLB 面朝 +Z，脚底位于 Y=0。资产有 20 根骨骼、22,193 个三角面、1 个着色材质，每顶点最多 4 根骨骼影响。可在 Blender 动作编辑器切换下列动作。

| 动作 | 时长 | 播放方式 |
| --- | --- | --- |
| Idle | 3.0 秒 | 循环呼吸和轻微转头 |
| Walk | 1.2 秒 | 原地循环，配合宿主平移。每个完整周期前进约 0.941 米 |
| TurnLeft90 | 1.0 秒 | 左转 90°，双脚分两次迈步 |
| TurnRight90 | 1.0 秒 | 右转 90°，双脚分两次迈步 |

转向片段把偏航写在 Hips 上。切出片段时，将完成的角度一次性叠加到场景角色朝向。预览包含转向衔接、行走起停和到站待机。此版本面向单个近景角色，面部表情、手指动作和人群远景模型可独立制作。

## 网页预览

在安装了仓库依赖的项目根目录运行下面的命令，然后访问[本地预览](http://127.0.0.1:8765/art-direction/tripo/researcher-03-v1/motion/preview.html)。可以暂停和重播，启用系统减少动态效果时由用户手动播放。

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

## 重建和验证

在仓库根目录运行。生成命令仅写入指定的输出目录。

```powershell
$model = 'art-direction/tripo/researcher-03-v1/scientist boy 3d model.glb'
$out = 'art-direction/tripo/researcher-03-v1/motion'
& 'G:/blender/blender.exe' -b --factory-startup --python-exit-code 2 -P tools/blender/rig_researcher.py -- $model $out
& 'G:/blender/blender.exe' -b --factory-startup --python-exit-code 2 -P tools/blender/verify_researcher_motion.py -- $out
```

Blender 检查覆盖四段动作共 190 个整数帧，检查下摆与裤腿重叠区域的三角面相交，并重新导入 GLB 校验蒙皮、骨骼和动作长度。Chrome 使用 Three.js 对完整周期和转向的鞋底位置进行采样，支撑脚锚点最大漂移约 0.18 毫米，摆动脚最高离地约 10.7 厘米。走到台阶前时，向前发射的视线命中入口玻璃，距离约 1.64 米。
