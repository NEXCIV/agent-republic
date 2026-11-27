# 03 号研究员动作样板

[早期动作录像](Researcher_03_Street.mp4) · [Blender 工程](CIVRUM_Researcher_03.blend) · [动画 GLB](CIVRUM_Researcher_03.glb)

E6-07 近景角色。街景预览从中央广场步行至 Agent 中心台阶前，沿用四段测试动作和既有路线。

## 资产

人物来自 `scientist boy 3d model (1).glb`。源文件 SHA-256 为 `851d6cad568edc3ad4e035a1c47b07e8d5590254c019072ecfe7adb75813042f`。保留新版几何和底色贴图。眼镜和头发跟随头部，耳机跟随胸部，衣摆由骨盆和左右大腿共同驱动。

角色在绑定姿势下高 1.68 米，GLB 面朝 +Z，脚底位于 Y=0。资产有 20 根骨骼、55,796 个三角面、一个材质，每顶点最多受 4 根骨骼影响。工程和动画 GLB 内嵌 8192 × 8192 原始贴图，网页副本 `agent-03.glb` 用 4096 × 4096。

| 动作 | 时长 | 播放方式 |
| --- | --- | --- |
| Idle | 3.0 秒 | 循环呼吸和轻微转头 |
| Walk | 1.2 秒 | 原地循环，配合宿主平移。每周期步幅 0.723 米 |
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
& 'G:/blender/blender.exe' -b --factory-startup --python-exit-code 2 -P tools/blender/rig_character_revisions.py -- --output cache/rebuild-avatars
& 'G:/blender/blender.exe' -b --factory-startup --python-exit-code 2 -P tools/blender/verify_character_revisions.py -- cache/rebuild-avatars
```

Blender 验证覆盖 190 个整数姿态，检查耳机绑定、UV 接缝位移、脚底接地和衣物几何拉伸。动画 GLB 重新导入后复核骨骼、权重、贴图和片段长度。
