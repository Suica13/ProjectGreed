# 生态群系 Tilemap 与共享部署

## 素材与配置

`assets/maps/biomes/catalog.json` 注册群系。每个群系使用一个目录，只有一张 `tiles.png`，以及一份 `biome.json`：

- tropical：用户提供的热带海岛图集原文件，保留 12×12 原始排列。
- temperate、desert、snow、urban、space：使用内置 imagegen，以该参考图为风格来源生成，各为 8×8 图集。

配置记录图片尺寸、资源 ID、各语义图块的裁切矩形和衔接参数。矩形排除图集黑色分隔线，不假设生成图片恰好为指定分辨率。添加同类变体时扩充对应 `frames` 数组；添加群系时新增目录并在 catalog 注册，然后为地图选择群系。素材通过共享 asset ID 打包，一张图片不会因多张地图引用而重复嵌入。

## 实际地图图层

`node tools/rebuild-biome-maps.cjs` 重建 17 张遭遇战、3 张雇佣兵战争地图的五层 Tilemap：地表、岸线与浅滩、高差与崖壁、道路与坡口、植被与遗迹。地表层保留真实地形规则；其余图层只影响表现，不将水域、树林或山区误转换成可通行平原。

雨林采用曲折河道和两处宽桥口，海陆补给线采用起伏海岸；道路沿双格可通行路线连接部署区或据点。战场地图保留基地、炮塔、雷达、据点、高地与坡口的游戏坐标。宇宙图保留大面积空域，仅在障碍区绘制小行星和残骸；殖民地内部区使用同一宇宙图集中的设施地板。

`node tools/rebuild-shared-encounter.cjs` 仍是遭遇战紧凑共享部署的入口。队友共用部署区域，双方出生点绕地图中心对称，不因席位数纵向拉长。现有战场地图生成器也接入群系重建器。

## 渲染与衔接

`shared/biome-tiles.js` 从群系图集生成可复用的像素纹理。地表纹理以世界坐标采样，采用镜像周期匹配同类地表边缘，避免缩放产生接缝。岸线由四向邻格掩码形成沙岸与浅水边；崖壁从图集中裁出岩壁，按高差叠加；道路根据邻接关系连续铺设，不直接拼接可能有误差的生成岸线图片。

`shared/tilemap-view.js` 为客户端和独立地图编辑器共用入口。战场沿用 `client/tilemap-renderer.js` 的有预算分块缓存，近景 64px/格、中景 32px/格、远景 16px/格，不在每次缩放重新绘制全图。纹理缓存使用图片对象的 WeakMap，地图释放图片后不会被全局强引用保留。

## 生成提示集与来源

工具模式：内置 imagegen，带用户参考图的风格参考生成；非 CLI。原始输出保留在生成目录，项目使用的副本位于各群系目录。热带图集直接使用用户原图。

共通提示：military tactical game biome TILESET; fine-grained muted pixel art; realistic irregular ground textures; high overhead slightly frontal oblique view; short downward front faces on cliffs; actual ground tiles and terrain transitions, not isolated decoration icons; crisp pixels, restrained contrast; no smooth painting, text or UI. One self-contained 8×8 atlas per biome. Rows: ground variants and water; vegetation/rock/ruins; shore edges and corners; plateau cliffs; dirt paths; concrete and paved roads; integrated details; ground transitions and ramps.

群系差分：温带为橄榄绿草地、苔藓、蓝绿河水及灰岩；荒漠为灰黄沙土、稀疏灌木、砂岩台地及绿洲；冰雪为灰白积雪、蓝灰冰层、针叶林和深蓝水面；城市为破损混凝土、沥青、杂草、低矮废墟及运河；宇宙以大片深蓝黑空域为底，少量小行星、残骸和空间站金属地板，禁止将全图填成小行星背景。

验证截图和日志统一放在 `tmp/verification/`，不放进 build 产物。
