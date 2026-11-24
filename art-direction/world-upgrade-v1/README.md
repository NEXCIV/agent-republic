# CIVRUM 旧城画风与布局升级

E6-07 的 300 × 300 米 Blender 美术城。打开 [升级场景](CIVRUM_World_Upgrade.blend) 即可检查灯光、街区和白模。正式网页街区继续使用自己的 `district-01@1` 场景清单。

| 固定机位 | 改造前 | 改造后 | 并排对比 |
| --- | --- | --- | --- |
| 城市全景，34 mm | [旧全景](../refined/renders/CIVRUM_World_Overview.png) | [新全景](renders/CIVRUM_World_Overview.png) | [全景对比](renders/Compare_Overview.png) |
| 西侧街景，30 mm，离地 2.25 米 | [旧街景](../refined/renders/CIVRUM_Street_Detail.png) | [新街景](renders/CIVRUM_Street_Detail.png) | [街景对比](renders/Compare_Street.png) |

改造前采用精修版已有的 Cycles 渲染，两张改造后原图使用相同位置、镜头与 1920 × 1080 画幅，96 采样并降噪。升级版采用更低的暖侧光、稍亮的天空补光和 +0.18 EV。对比图由两张原图等比缩小拼合。[旧城盘点和选址图](../refined/改造规划.md) · [可恢复备份](../refined/blender/world_legacy_backup.blend)

## 四个替换槽位

Blender 坐标以米计，+Y 向北，+Z 向上。下表的宽沿入口立面测量。Agent 中心朝东，世界包围盒的 X 尺寸因此等于建筑进深。完整坐标、朝向、含悬挑尺寸、底部 0.35 米范围及源文件指纹均在 [地标清单](landmarks_manifest.json)。

| 地标 | 世界锚点 XYZ | 入口 | 宽 × 深 × 高（米） | 当前白模 |
| --- | --- | --- | --- | --- |
| HERO_01_Governance_Hall | 0, 95, 0.172 | 南 | 33.00 × 19.00 × 13.68 | 根据议会参考制作的穹顶与门廊占位 |
| HERO_02_Agent_Center | −95, 65, 0.172 | 东 | 7.00 × 5.06 × 6.74 | 既有 Agent 街景样板，门与台阶保持原比例 |
| HERO_03_Citizen_Registration | 80, 21, 0.158 | 南 | 13.00 × 10.80 × 8.33 | 英文文件名的注册中心白模，占用住宅南前庭 |
| HERO_04_Public_Construction | 95, −82, 0.172 | 北 | 23.00 × 17.22 × 14.91 | 公共建设中心白模，包含吊臂，南面接货运院 |

四个网格分别位于 `03_Hero_Landmarks`，局部坐标的底部中心为零，旋转为零，缩放为一。承托面高于城市原点的地块使用实测世界 Z。旧议会、研究中心、工坊和对应字牌保存在隐藏集合 `Legacy_Replaced_Massing`。中央 Nexus、住宅和西南论坛继续使用旧城资产。

## 街景与人物

56 栋背景楼沿用其体量和位置，按七种共享立面模块补入橱窗、窗楣、雨棚和店面。西侧研究区另设阅览楼与前庭候坐处。步道嵌条、排水篦、广场罗盘、地图牌与候坐棚帮助行人辨认路口。街道家具共用青绿烤漆、黄铜、暖木、陶橙、玻璃及暖白灯罩材质。东侧两组树池、长椅和路灯已移至注册中心边缘。

`04_Character_Activity` 包含 01 至 08 八个 Empty，按编号对应城市居民、建设工人、研究员、创作者、城市居民、商业服务、创意居民、城市技术员。每个对象记录活动与承托面，具体坐标见 [验证记录](verification.json)。它们是后续放置角色的编辑器标记。

Blender 5.3 已重开原件备份与成品，核对 172 个道路对象的变换、三台相机、四个白模的底部中心及落地点。地标包围盒和八个模拟人体占地均已检查周围建筑、绿化及道具。静态可见网格按实例累计从 965,881 降至 874,464 个三角面。其中，99 盏路灯从 362,376 降至 73,932，14 张长椅从 70,560 降至 7,840。这是 Blender 场景统计，网页端帧率需随成品贴图和运行时实例化单独测试。

## 复核与后续替换

以下 PowerShell 命令在项目根目录执行。第一条复核现有交付物。第二条演示用 Agent 白模试算对齐，输出尺寸差，默认只在内存中操作。

```powershell
$blender = 'G:/blender/blender.exe'
$city = 'art-direction/world-upgrade-v1'
& $blender -b --factory-startup --disable-autoexec --python-exit-code 2 --python scripts/verify_civrum_city_upgrade.py -- $city
& $blender -b "$city/CIVRUM_World_Upgrade.blend" --disable-autoexec --python-exit-code 2 --python scripts/align_civrum_landmark.py -- "$city/landmarks_manifest.json" HERO_02_Agent_Center 'art-direction/tripo/agent-center-v3/benchmark/CIVRUM_Agent_Center_Street.glb' --front north
```

`--front` 是新 GLB 导入 Blender 后的入口方向，按模型实况选择 north、south、east 或 west。工具围绕竖轴旋转、按临街宽度等比缩放，最后对齐世界底部中心。先看打印的三轴尺寸差，再核对入口与吊臂净空。确认成品后显式增加 `--save-as 新文件.blend` 才会写出替换版本，既有文件不能作为输出。三个现有 GLB 的试算尺寸差均为零。议会的成品 GLB 到位后需要单独复核。

## 从备份重建

下例将中间文件和重建成品放进临时目录。注册中心源文件可用 `--registry` 指定，公共建设中心源文件预期位于 `art-direction/tripo/construction-center-v1/public construction center 3d model.glb`。打开已交付的 Blender 工程不需要这两个外部文件。

```powershell
$blender = 'G:/blender/blender.exe'
$passes = Join-Path $env:TEMP 'civrum-city-rebuild'
$backup = 'art-direction/refined/blender/world_legacy_backup.blend'
$script = 'scripts/upgrade_civrum_world.py'
& $blender -b $backup --python-exit-code 2 --python $script -- slots $passes --registry "$env:USERPROFILE/Downloads/citizens registration center 3d model.glb"
& $blender -b "$passes/02_Slots.blend" --python-exit-code 2 --python $script -- streets $passes
& $blender -b "$passes/03_Streets.blend" --python-exit-code 2 --python $script -- light $passes
foreach ($view in 'overview','street') {
    & $blender -b "$passes/CIVRUM_World_Upgrade.blend" --python-exit-code 2 --python $script -- render "$passes/renders" --camera $view
}
```
