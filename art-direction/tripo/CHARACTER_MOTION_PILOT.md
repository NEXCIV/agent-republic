# NEXCIV · 02 和 06 号动作试片

任务 E6-07。运行 `node scripts/start-nexciv-shared.mjs` 后打开 [角色动作对照](http://127.0.0.1:3142/nexciv-preview/motion)。左侧 100STYLE 真人动捕，右侧 Quaternius。两个画面同步播放同一角色的走停或转身，共用镜头和进度。用侧面和 0.5× 慢放对照摆臂、抬脚和鞋底倾角。

## 素材

- 100STYLE Dataset，Ian Mason、Sebastian Starke、Taku Komura，许可 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。取 `Neutral_FW.bvh` 约 8.95–10.28 秒的平直步段，裁切、重采样、重定向并调整重心和脚底接触。 [数据集和许可](https://zenodo.org/records/8127870) · [作者下载页](https://www.ianxmason.com/100style/)
- Quaternius Universal Animation Library Standard，Quaternius，许可 [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。从免费包的 Root Motion GLB 取 `Walk_Loop`，重定向并使用统一的试片路径。 [作者下载页](https://quaternius.itch.io/universal-animation-library)
- KayKit Character Animations 1.1，Kay Lousberg，许可 [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。坐起使用免费版 Rig Medium。 [作者下载页](https://kaylousberg.itch.io/kaykit-character-animations) · [固定版本镜像](https://github.com/GeorgeQLe/assets-kaykit-3d-characters/tree/af08a62d3669370ec4636ae6314b38cdcd5dd759/assets/kaykit/character-animations-1.1/Animations/gltf/Rig_Medium)

| 输入 | 使用动作 | SHA-256 |
| --- | --- | --- |
| `Rig_Medium_General.glb` | `Idle_A` | `5f725c0f745f36078c7238968cd5c04843cbc6260689eb6e7f5e2bbd7ffdd7ad` |
| `Rig_Medium_Simulation.glb` | `Sit_Chair_Down`、`Sit_Chair_Idle`、`Sit_Chair_StandUp` | `ab6ffeed40c8281dd0ce0506534eadf7385151f1c266643a10fa2a0f0a7ba3b1` |
| `Neutral_FW.bvh` | Forward walking | `2f28800baa299547c42c257d1c926172542a1e69b46a3d3e6aa0aded0e9b40f6` |
| `Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard_RM.glb` | `Walk_Loop` | `be684571ed655a1b892c2c07e6e2aeca053b606c442d34004adaf1d944090d01` |

将对应输入放入 `cache/nexciv-motion-source`，保留 Quaternius GLB 的两层子目录，在仓库根目录重新生成。

```powershell
node apps/web/scripts/bake-motion-preview.mjs cache/nexciv-motion-source
```

脚本以 60 Hz 烘焙走路和转身，以 30 Hz 烘焙坐起，把 02 和 06 号的动画关键帧与目标模型 SHA-256 写到 `apps/web/public/nexciv-motion`。每个角色按需加载一个约 420 KB 的 JSON（压缩前）。两个画面共用模型几何、材质与 WebGL 上下文。浏览器设为减少动态效果时，页面以暂停状态打开。

## 核对项

- 两种试片沿同一路径起步、加速、减速，并以城市 Agent 默认巡航速度 1.25 m/s 行走。两版共用按角色腿长计算的落脚点，用各自动作源驱动上身、抬脚高度和鞋底倾角。
- 转身由项目安排三次换脚，动作源驱动重心和上身摆动。烘焙检查统计支撑踝与目标位置的误差、抬脚高度和帧间髋部位移。网页试片覆盖固定直线路径和原地转身，实际城市场景的任意路径拐弯、坡道和台阶仍需验证。
- 已烘焙的 KayKit 坐起片段带椅面校准和鞋底姿态修正，仍保存在角色动作数据中。
- 06 号的围裙前片会随抬腿明显翘起。若采用这组坐姿，应先做围裙蒙皮或坐姿修形，再验证实际城市中的坐具接触。
