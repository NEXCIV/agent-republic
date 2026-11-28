# NEXCIV · 02 和 06 号动作试片

任务 E6-07。运行 `node scripts/start-nexciv-shared.mjs` 后打开 [角色动作对照](http://127.0.0.1:3142/nexciv-preview/motion)。两个画面使用同一份正在使用的网页角色模型，左侧播放城市现有动作，右侧播放重定向后的动作。切换角色、动作或观察角度，用 0.5× 和进度条查看脚底、椅面和围裙。

## 素材

[KayKit Character Animations 1.1](https://kaylousberg.itch.io/kaykit-character-animations)，作者 Kay Lousberg，许可 [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。使用免费版的 Rig Medium 动作。试片只分发重定向后的骨骼关键帧。转身由行走动作衍生，加入步幅衰减、朝向变化和支撑脚补偿。

| GLB | 使用动作 | SHA-256 |
| --- | --- | --- |
| `Rig_Medium_General.glb` | `Idle_A` | `5f725c0f745f36078c7238968cd5c04843cbc6260689eb6e7f5e2bbd7ffdd7ad` |
| `Rig_Medium_MovementBasic.glb` | `Walking_A` | `11422afd50abf7e8c92ea107e2e0bc94abd38023d6d15f55ad580347efbfa29e` |
| `Rig_Medium_Simulation.glb` | `Sit_Chair_Down`、`Sit_Chair_Idle`、`Sit_Chair_StandUp` | `ab6ffeed40c8281dd0ce0506534eadf7385151f1c266643a10fa2a0f0a7ba3b1` |

本次使用[固定版本的免费动画镜像](https://github.com/GeorgeQLe/assets-kaykit-3d-characters/tree/af08a62d3669370ec4636ae6314b38cdcd5dd759/assets/kaykit/character-animations-1.1/Animations/gltf/Rig_Medium)。将三份 GLB 解压到同一目录，在仓库根目录重新生成。

```powershell
node apps/web/scripts/bake-motion-preview.mjs cache/nexciv-motion-source
```

脚本按 30 Hz 采样，把 02 和 06 号的骨架旋转、髋部位移、步幅和预览坐凳尺寸写到 `apps/web/public/nexciv-motion`。每个文件约 138 KB，记录目标模型的 SHA-256。调整角色骨架或蒙皮后，重新生成并复查对应动作。预览按需读取当前角色的模型和关键帧，两个画面共用模型几何、材质与一个 WebGL 上下文。浏览器设为减少动态效果时，页面以暂停状态打开。

## 核对项

- 走路与停步共用同一路径和速度，通过各自的步幅调整片段播放频率。进入和退出循环的过渡仍可能滑步。
- 坐起试片带椅面校准和鞋底姿态修正。旧动作一侧重现城市里的即时坐姿和落座高度，预览另加了对齐坐凳的水平位移。
- 06 号的围裙前片会随抬腿明显翘起。若采用这组坐姿，应先做围裙蒙皮或坐姿修形，再验证实际城市中的坐具接触。
