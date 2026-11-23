# CIVRUM 01 号城市居民 · 角色建模参考

| 文件 | 视角 | 分辨率 |
| --- | --- | --- |
| [正面](01-front.png) | 自然 A 字站姿，视线平直 | 1024 × 1536 |
| [侧面](02-profile.png) | 90° 侧面，鼻尖朝画面左侧 | 1024 × 1536 |
| [背面](03-back.png) | 后脑、帽兜、夹克和工装裤背面 | 1024 × 1536 |
| [正脸近照](04-face-front.png) | 中性表情，供面部雕刻参考 | 1254 × 1254 |

三张全身图用于确定站姿、服装轮廓和体型。以正面图为基准，侧面和背面按头顶与鞋底对齐。斜挎包与背带留作独立配件。正脸近照用于核对发际线、眉眼、鼻形和唇线。

## 生成提示词

使用内置 ImageGen。正面取自用户提供的八人设定图中左上角的 01 号。侧面、背面和近照均使用同一张正面成图作为输入。

### 01-front.png

```text
Use case: production reference for a stylized character sculpt, skinning and animation. Use ONLY citizen 01, male urban resident, top LEFT of the supplied cast sheet. Create ONE new portrait-format image, a strict straight-on FRONT orthographic full-body model reference of this exact character in a relaxed symmetrical A-pose. Single character single view, a centered clean studio plate without lettering or graphics. Match his appealing youthful stylized proportions, about 4.7–5 heads tall, softly squared round face, very dark warm brown eyes with restrained highlights, peach cheeks, small rounded nose, thick dark brown brows, short voluminous chocolate-brown hair shaped in chunky swept wavy curls including his distinctive lifted front curl. Match original outfit: open teal bomber with one mustard yellow band on each upper sleeve and cream trim/cuffs, plain cream hoodie underneath with hood down and two drawcords, dark blue slate cargo trousers with pocket on each thigh, cuffed hems, teal/cream/yellow lace-up sneakers. Base character for rigging: leave off the removable diagonal satchel AND its strap; no props, nothing obscuring arms or clothing. Body faces directly forward, gaze straight ahead, eyes open naturally, brows level, lips gently closed, neutral resting face with no smile. Shoulders relaxed and level, both arms extend down and sideways about 30 degrees from the torso (A-pose, upper arms and forearms almost straight); both hands well clear of hips with negative space, natural relaxed slightly splayed five fingers, thumbs anatomically correct and clearly separated. Hands empty and visible. Weight centered, level hips, knees straight but not locked, feet hip-width apart, both feet parallel and pointing directly forward on one ground plane. Level orthographic camera with no yaw, no pitch, no foreshortening, no wide lens. Entire silhouette from topmost curl to both shoe soles with margin. High-quality game character sculpt in the same tactility/style as 01, clean seams, readable folds, modest roughness variation, no noisy textile weave, no busy branding. Uniform very light neutral gray studio backdrop, broad soft light, subtle contact shadow. Portrait frame 2:3 with 5–8% clear margin above hair and below soles. No cast sheet, lines, measurement text, border or logo.
```

### 02-profile.png

```text
EDIT the CAMERA only. Exact identity, body, head-to-body proportions, garment construction, hairstyle, pose, lighting direction softly from above, plain light gray background of this single master reference. Same premium tactile 3D stylized game-character maquette, not a new design. No writing, no set, no bag or strap, no embellishment. STRICT RIGHT PROFILE full body, a literal 90-degree orbit of the FRONT photo. His nose and toes point exactly LEFT on the page. Only ONE eye and brow visible. The second arm and leg project directly behind the nearer ones because the A-pose was symmetrical; both legs remain planted, no contrapposto. Show the near arm edge-on and maintain the hand's vertical height just like master, the palm natural, and the hoodie hood hangs BEHIND the neck. Correct near-side thigh cargo pocket and profile of sneaker. Match the master's 1024×1536 portrait composition EXACTLY, hair top 2.3% down, soles at 96.3% of frame height. Keep soles at the same level, head looking level, pelvis level. Center subject. Arms frozen in the original A-pose with the same shoulder, elbow, wrist and fingertips heights. Feet exactly parallel, feet and head pointing same direction. Orthographic, level camera, all in focus, no additional view or perspective.
```

### 03-back.png

```text
EDIT the CAMERA only. Exact identity, body, head-to-body proportions, garment construction, hairstyle, pose, lighting direction softly from above, plain light gray background of this single master reference. Same premium tactile 3D stylized game-character maquette, not a new design. No writing, no set, no bag or strap, no embellishment. Exact 180-degree REAR elevation. Camera centered directly behind him, facing his back. Both ears symmetric, NO face or profile visible. Center rear of the cocoa chunky sculpted curls consistent with the frontal forelock, back of cream hoodie hood drapes over the teal jacket between shoulders, single yellow band on the upper portion of each sleeve, cream cuffs and lower jacket hem. Plain teal jacket back no graphics, dark slate cargo pants with lateral pockets and rolled hems, sneaker heels in cream/teal/yellow color blocking. Relaxed fingers slightly separated, correct thumbs and hand orientation for a rear view. Both heels straight towards the camera. Match the master's 1024×1536 portrait composition EXACTLY, hair top 2.3% down, soles at 96.3% of frame height. Keep soles at the same level, head looking level, pelvis level. Center subject. Arms frozen in the original A-pose with the same shoulder, elbow, wrist and fingertips heights. Feet exactly parallel, feet and head pointing same direction. Orthographic, level camera, all in focus, no additional view or perspective.
```

### 04-face-front.png

```text
EDIT the CAMERA only. Exact identity, body, head-to-body proportions, garment construction, hairstyle, pose, lighting direction softly from above, plain light gray background of this single master reference. Same premium tactile 3D stylized game-character maquette, not a new design. No writing, no set, no bag or strap, no embellishment. Produce a straight-on neutral head study: close-up camera framing of this exact master face for facial modeling. Keep all details EXACTLY the same including the asymmetric lock hanging down at the front and the wave near the temple, the expression, shape and relative positions of both rounded ears, eyes, pupils, eyebrows, nose, lips, jaw and hairline. Eyes open looking straight at camera, eyelids level, gently CLOSED lips in a relaxed neutral straight line, brows resting, zero smile or frown. Strict frontal orthographic portrait crop from just ABOVE the tallest curl to top of chest; include both full ears, entire hairstyle, chin, neck and cream hood at bottom. Face should fill frame, no facial expression chart or props. Output one square high resolution face reference. Avoid realistic skin pores, eyelashes/makeup or new freckles. Retain front reference geometry rather than beautifying or changing its facial proportions.
```
