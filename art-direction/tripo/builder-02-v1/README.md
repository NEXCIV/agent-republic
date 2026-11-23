# CIVRUM 02 号建设工人 · 三视图

[建设工人绑定工程、游戏模型与动作录像](motion/README.md)

| 文件 | 视角 | 分辨率 |
| --- | --- | --- |
| [正面](01-front.png) | 双臂自然外展，面部保持中性 | 1024 × 1536 |
| [侧面](02-profile.png) | 右侧 90°，鼻尖和鞋尖朝向画面右侧 | 1024 × 1536 |
| [背面](03-back.png) | 后方 180°，黄色工具袋位于画面右侧 | 1024 × 1536 |

三张图以同一套 A 字姿势制作。按安全帽顶到鞋底测量，三张图的人物高度分别为 1456、1455 和 1457 像素。右侧图中，远侧手脚与近侧手脚自然重叠。工具袋、手套和安全帽随人物整模使用。

## 生成提示词

使用内置 ImageGen。正面基准使用用户提供的八人设定图，侧面和背面沿用该正面基准。交付前修正正面的嘴部表情和背面的皮带扣与护膝。

### 正面基准

```text
Make the FRONT master for a game character's orthographic turnaround, portrait 2:3 at 1024×1536. The attached drawing is a STYLE AND IDENTITY REFERENCE only. Use ONLY the man in the SECOND column of the TOP row, labeled 02 Male Builder. Output a single complete high-quality stylized 3D figure in the civic game art style of the reference, centered on an evenly lit plain pale neutral gray background. Render with soft diffuse studio light and at most a tiny diffuse ground-contact shadow. No logos, graphics, borders, annotations, extra figures, text or panel layouts.

Identity and workwear: the compact stylized young adult builder in the reference with broad cheeks and rounded ears, brown eyes, and short dark-brown hair under his golden-yellow hard hat. Rounded blue-teal goggle lenses with bronze trim mounted side by side on the FRONT of the helmet, above the eyes; dark muted strap goes around the helmet. Orange high-visibility sleeveless vest with silver reflective stripes, over the collared medium slate-blue shirt with blue rolled sleeves. Black charcoal fabric work gloves (five distinct fingers) match the reference rear view. Belt with centered simple square yellow buckle, compact brown utility pockets and a snug, short yellow tool pouch on the viewer-left hip, no dangling tools and no handheld objects. Blue cargo work trousers with knee patch and utility pocket construction, single gray rolled cuffs. Yellow leather work boots with a dark toe bumper and chunky dark outsole. Match the source proportions: stylized larger head, compact and slightly stocky body, believable clear shapes, tactile matte materials, straight aligned legs. Keep the construction-worker color palette and exact equipment layout. Keep a retrievable silhouette at every joint.

CAMERA AND POSTURE: true orthographic head-on front camera dead level to the character, zero pitch, zero roll, zero yaw; shoulders and both boots shown symmetrically. Natural neutral A-pose, NOT crossed arms or hands on hips from the drawing. Both arms equally angled 27 degrees down and outward from vertical, elbows almost straight but relaxed, forearms and hands in a continuous line, hands well clear of pockets and torso. Relaxed wrists, fingers softly extended and lightly spaced, thumbs visible, no fist. Both knees straight but relaxed. Feet shoulder-width apart and COMPLETELY PARALLEL, both toes facing camera, soles at the same height. Neck vertical, eyes forward, brows relaxed, closed lips resting in a neutral expression. Include the full helmet top, fingertips and soles. Head centered on the vertical canvas axis, highest helmet point at y = 2.4% to 3.0% of canvas height, bottom of outsoles y = 96.0% to 96.7% of canvas height, no vertical perspective or camera foreshortening. This exact pose, silhouette and color/material scheme will be used as the modeling master for both additional views.
```

### 右侧 90°

```text
Use the attached single front-view image as the source master of this exact stylized male builder. Generate one new orthographic view of that same fixed figurine; change only the viewing direction. Preserve exactly the compact anatomy, head-to-body ratio, helmet crown and front brim, goggles and strap, ears, blue collared shirt and rolled cuffs, reflective orange vest, dark gloves, brown belt and yellow buckle, knee pads, cargo pockets, rolled pant cuffs, and gold/yellow work boots. The yellow pouch is on the FIGURE'S RIGHT hip (viewer's LEFT in the source front view); small brown pouch on FIGURE'S LEFT. Never mirror or duplicate these pouches. Everything on the same horizontal levels as in the input, including wrists, waist, knees, pants cuffs and soles. Use the same portrait 2:3 canvas 1024×1536, soft even studio lighting, gray background, no typography, symbols, lines, borders or overlays. Keep helmet top at about y=29 pixels, outsole bottom at about y=1483 pixels, centered figure. Keep both arms at exactly the reference's natural A-pose angle, hands loose without touching torso, fingers relaxed and spaced, soles flat, feet parallel, expression neutral. Do not re-pose. Keep material surfaces and colors. STRICT SIDE PROFILE, turn exactly 90° from front, nose and toes facing SCREEN RIGHT. Show the anatomical right side including the yellow tool pouch. Only one eye and one cheek visible; one boot silhouette, near and far feet superimposed because the pose is symmetric, not staggered, arms likewise superimposed when their projections align. The boot heel is clearly visible on the left and toe box on the right. Hands remain lifted out from the hips toward the camera in depth, as required by the same A-pose, so natural overlap of hands over the trouser silhouette in this orthographic side view is correct. The front-mounted goggles appear on the helmet's forehead at the right, with one lens readable and the band following the helmet toward its back on the left. Horizontal level camera, no perspective, no back three-quarter, no head turn, no bloom.
```

### 背面 180°

```text
Use the attached single front-view image as the source master of this exact stylized male builder. Generate one new orthographic view of that same fixed figurine; change only the viewing direction. Preserve exactly the compact anatomy, head-to-body ratio, helmet crown and front brim, goggles and strap, ears, blue collared shirt and rolled cuffs, reflective orange vest, dark gloves, brown belt and yellow buckle, knee pads, cargo pockets, rolled pant cuffs, and gold/yellow work boots. The yellow pouch is on the FIGURE'S RIGHT hip (viewer's LEFT in the source front view); small brown pouch on FIGURE'S LEFT. Never mirror or duplicate these pouches. Everything on the same horizontal levels as in the input, including wrists, waist, knees, pants cuffs and soles. Use the same portrait 2:3 canvas 1024×1536, soft even studio lighting, gray background, no typography, symbols, lines, borders or overlays. Keep helmet top at about y=29 pixels, outsole bottom at about y=1483 pixels, centered figure. Keep both arms at exactly the reference's natural A-pose angle, hands loose without touching torso, fingers relaxed and spaced, soles flat, feet parallel, expression neutral. Do not re-pose. Keep material surfaces and colors. STRICT 180° REAR VIEW directly behind the figure, no head turn, no face or eye visible. Helmet rear shows strap wrapping horizontally around shell and dark hair below; goggles stay on front and are not displayed on the back of helmet. Safety vest is orange with two upright pale-silver reflective shoulder stripes and two horizontal silver waist bands at the same levels as the front, consistent with the reference workwear. Show glove backs appropriately and back of boots, at exact same reach as the front. Figure's right side is SCREEN RIGHT here, so yellow tool pouch to the right, brown smaller utility pouch to the left. The shape of the near-vertical trouser legs, gap between boots and angle of each arm match the front view. Absolutely no perspective / overhead or 3/4 rotation.
```

### 背面细节修正

```text
Make a localized correction to the attached exact REAR VIEW of a game character. EDIT ONLY TWO SMALL AREAS, the center of the belt at the small of the back, and the backs of the knees. Right now there is an anatomically wrong gold rectangular front belt buckle placed at the center on the back. Remove the gold buckle completely from the center, replacing it with a continuous straight section of plain dark brown leather belt that exactly matches the immediately adjacent belt on both sides. Keep the two blue belt loops. Remove BOTH big blue rectangular stitched pads on the backs of the knees. Substitute unbroken matching blue work-pant material there with very subtle cloth folds, plain and smooth, leaving the OUTSIDE cargo pockets on both thighs fully intact. The front knee pads are always invisible from this strict rear camera. The brown left pouch and yellow right pouch are also fully preserved. Keep the same silhouette, proportions and pixel registration: topmost helmet y 27, boot soles y 1482 on the 1024x1536 portrait canvas, same arm angles, fingers, straight legs, exact same clothing, colors, background and framing. Do not change the angle or pose. Keep helmet, head, sleeves, vest, reflective stripes, both pouches, boots, and all other visual details exactly as in input. Render the corrected full-length character with no annotations, not a comparison.
```

### 正面表情修正

```text
Make an extremely localized edit to this exact full body FRONT view, for a modeling reference. Change ONLY the tiny mouth line: replace the slight upturn of the lip corners with a straight relaxed closed mouth, visually neutral, soft line, not a frown. No other area should change. Keep the exact same identity, ears, eyebrows, eyes, helmet, outfit, glove fingers, A pose, silhouette, plain gray background and portrait 1024×1536 framing. Highest point of helmet around y=29, outsole bottom around y=1483. Keep the whole character on exactly the same pixel coordinates as the source, including both wrists, parallel boots and all costume details. Preserve original soft studio lighting. Result one full-length image.
```
