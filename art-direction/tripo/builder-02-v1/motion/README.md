# 02 号建设工人动作样板

[早期动作录像](Builder_02_Street.mp4) · [Blender 工程](CIVRUM_Builder_02.blend) · [动画 GLB](CIVRUM_Builder_02.glb)

E6-07 近景角色。以 `construction worker 3d model 1.glb` 为源，按新版肩宽、髋高和靴子位置重新校准共用的 20 骨骼。绑定高度为 1.72 米。安全帽和护目镜跟随头部，腰带、搭扣和工具包跟随骨盆，靴子和鞋带跟随对应脚骨。

| 动作 | 时长 | 接入方式 |
| --- | --- | --- |
| Idle | 3.0 秒 | 循环待机 |
| Walk | 1.2 秒 | 原地循环，每周期步幅 0.826 米。宿主沿地面平移 |
| TurnLeft90 / TurnRight90 | 各 1.0 秒 | 分两次迈步转身，结束时将 90° 朝向交给宿主 |

GLB 面朝 +Z，绑定姿势下脚底位于 Y=0。新版有 52,955 个三角面，每顶点最多受 4 根骨骼影响。工程和动画 GLB 内嵌源文件的 8192 × 8192 底色贴图，网页副本 `agent-02.glb` 用 4096 × 4096。源文件 SHA-256 为 `f2ffc834d6658b623f60ea13988e4b6613492fca61857a5219f78d476821c380`。

## 预览

在安装了仓库依赖的项目根目录运行下面的命令，然后打开[建设工人街景预览](http://127.0.0.1:8765/art-direction/tripo/researcher-03-v1/motion/preview.html?character=builder)。浏览器启用减少动态效果时，可用播放按钮启动。

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

## 重建和验证

在仓库根目录使用 Blender 5.3。重建需要上述原始模型。验证只需交付目录中的 Blender 工程和 GLB。

```powershell
& 'G:/blender/blender.exe' -b --factory-startup --python-exit-code 2 -P tools/blender/rig_character_revisions.py -- --output cache/rebuild-avatars
& 'G:/blender/blender.exe' -b --factory-startup --python-exit-code 2 -P tools/blender/verify_character_revisions.py -- cache/rebuild-avatars
```

Blender 验证覆盖 190 个整数姿态，检查装备绑定、UV 接缝位移、脚底接地、几何拉伸，以及动画 GLB 重新导入后的贴图和四段动作。
