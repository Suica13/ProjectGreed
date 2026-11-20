# 基地仓储

入口：主菜单「基地 → 格纳库」。只按台数管理库存，不使用容量点。

| 库存 | 每页格子 | 默认页数 | 台数上限 |
| --- | --- | --- | --- |
| 单位机库 | 8 | 3 | 24 |
| 战舰船坞 | 3 | 3 | 9 |

每格固定保存一台机体，大型单位也只占一格。战舰和航空运输机归船坞，其余机体归单位机库。

点击空位打开生产面板，可以搜索单位、选择出厂套件并生产到该空位；点击已有单位打开单位面板，可以免费切换合法套件或查看详细参数。许可、科技和资源条件沿用现行规则。没有常驻左侧详情栏。

机库采用封闭车间地面与整备支架；船坞采用独立的封闭科幻泊位。均为正上方正交俯视视角，不展示底部及左右的围墙。单位按当前套件朝下绘制。

经济存档 schemaVersion 为4，storage.units 与 storage.ships 保存逐台记录和固定格位，inventory 是供编组与结算使用的数量索引，二者在经济事务中一起校验保存。旧版经济存档首次读取或导入时清空原有机体与套件库存，保留资金、物资、许可、科技、驾驶员及奖励防重记录；新档不再预发旧的五份初始编组。已使用新版仓储的存档继续保留，不再次清空。

生产前检查空位，不足时不扣资源。奖励超出数量上限的单位保存到待入库队列，不算可出击库存；腾出空间后在格纳库点击「领取待入库单位」。出售或损失单位后其他格位不前移。重复结算仍按原收据规则防重。

策略模式与占山为王模式已移除，不再提供创建入口，不再加载专用地图和战役界面，服务端拒绝其模式和动作请求。历史说明仅供查阅。

## 美术素材与生成提示词

使用内置 imagegen 生成，原图保存在 assets/ui/source/，运行时资源为 assets/ui/warehouse-workshop.jpg、warehouse-port.jpg、storage-rack.png、storage-berth.png。背景压缩为 JPEG，槽位保留透明 PNG；构建在视口单位替换完成后才嵌入图片，避免损坏 Base64。

共用提示词：

> Use case: stylized-concept. Pixel-art game asset. STRICT ORTHOGRAPHIC TOP DOWN PLAN VIEW looking straight vertically down, parallel lines, absolutely no perspective, no isometric, no angled front walls, no vanishing points, no left or right tilt. Dark muted charcoal steel and blue gray, moderately worn sci-fi military machinery, restrained cyan indicators and yellow safety stripes, crisp readable detailed pixel contours, not bright sterile, not photoreal or blurry. No text, no units, no robots.

各图追加：

- 车间：Landscape background: enclosed futuristic maintenance workshop floor. Eight EMPTY areas will receive rack sprites later. Mostly flat dark floor with panels and service lines, pipes and overhead gantries only along edges. Indoor industrial atmosphere. Do not draw racks or garages or slot dividers in center.
- 船坞：Landscape background: gigantic enclosed SPACE NAVAL DRYDOCK floor, distinct from a robot workshop. Mostly dark flat steel floor with recessed service rails running vertically and heavy dock infrastructure around edges. No water, no vessels. Three ship berth sprites will overlay the central area later. Dense sci-fi dock machinery at outer edges only, center uncluttered.
- 支架：Transparent isolated sprite of ONE empty ROBOT MAINTENANCE SUPPORT RACK from directly overhead. Rectangular narrow steel platform running up/down, U-shaped mechanical support rails on left and right sides, crossbrace at rear top, small maintenance arms and machinery at corners. Center entirely empty and open. Not a building, no roof or walls. Full object visible with transparent surrounding area. Symmetric straight vertical alignment.
- 泊位：Transparent isolated sprite of ONE long empty SPACE WARSHIP DOCKING BERTH from directly overhead. Vertical orientation, much longer than wide. Two heavy segmented service piers on left and right, articulated docking clamps and cyan guide lights, connected by rear machinery across top. Dark empty central recessed docking channel open at bottom for a ship to occupy. Enclosed harbor dock infrastructure, no water and no ship. Entire object visible, transparent surrounding area. Visibly different from a robot maintenance rack, heavy naval scale.

两个背景最后执行同一编辑提示词：

> Edit this game background. Preserve the strict top-down orthographic view, dark muted sci-fi pixel art, floor panel style and industrial materials. REMOVE ALL framing infrastructure, fences, walls, pipes and machinery along LEFT, RIGHT and BOTTOM edges. Replace those entire three edges with seamless continuation of the flat interior floor. The room extends beyond the image boundaries. At TOP edge only retain a narrow band of machinery / gantry. Mostly empty usable floor. Do not add borders or frames. No perspective, no units, no text.
