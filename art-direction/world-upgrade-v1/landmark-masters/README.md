# CIVRUM · 300 米城市建筑母版

打开 [CIVRUM_World_300m_Master.blend](CIVRUM_World_300m_Master.blend)。复制到其他电脑时，请一并复制同级的 `buildings/` 目录。主场景以相对路径链接三栋建筑的网格，各建筑文件已内嵌原始 8192 × 8192 底色贴图。

本版从[已有资产布置场景](../asset-placement/CIVRUM_World_Inhabited.blend)另存，复用原地标槽位、路网、八名角色和相机。Blender 5.3 重开后核对了场景内 1,009 个对象的变换。三个地标均与源 GLB 的三角面数一致，内嵌底色贴图的 SHA-256 也与源图逐一匹配。

| 地标 | Tripo 源文件 | 三角面 | 可编辑的建筑文件 |
| --- | --- | ---: | --- |
| 议会 | `governance-hall-v1/domed building 3d model.glb` | 1,873,319 | [Governance_Hall.blend](buildings/Governance_Hall.blend) |
| Agent 中心 | `agent-center-v3/agent center 3d model 1.glb` | 1,925,258 | [Agent_Center.blend](buildings/Agent_Center.blend) |
| 公共建设中心 | `construction-center-v1/public construction center 3d model (2).glb` | 1,843,389 | [Public_Construction.blend](buildings/Public_Construction.blend) |

公民注册中心 `HERO_03_Citizen_Registration` 和中央 Nexus 塔 `CIVRUM_PH_CENTRAL_NEXUS` 在主场景的对象自定义属性中标为 `asset_status = PENDING_REPLACEMENT`。三栋成品使用 `SOURCE_MASTER_8K`。

## 同机位预览

[建设中心](renders/Construction_Walk.png) · [Agent 中心](renders/Agent_Center.png) · [议会](renders/Council_Square.png) · [全城俯视](renders/World_Overview.png) · [前后细节对比](renders/Landmarks_Comparison.jpg)
