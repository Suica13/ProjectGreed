# 机库卡片背景

使用内置 imagegen 生成，最终采用正交俯视角；两张图均为空场景，单位贴图仍由现有预览渲染器叠加，保持朝向、比例和战损状态。背景内嵌到独立HTML，不依赖外部文件请求。

- [单位背景](../../assets/ui/warehouse-unit-topdown.webp)：较紧凑的维修区、周边维护设备、黄色停车线。
- [舰船背景](../../assets/ui/warehouse-ship-topdown.webp)：大面积连续地板、稀疏导轨和远处小型设施，保持开阔观感。

最终生成提示词如下。

## 共用提示词

单位图：

Use case: stylized-concept. Asset: landscape 4:3 background for a game inventory card, behind a small unit sprite. STRICT ORTHOGRAPHIC TOP-DOWN / BIRD'S EYE VIEW, camera points vertically down at floor, no horizon, no visible room wall faces, no ceiling. Inspired by reference's enclosed blue-gray industrial sci-fi maintenance interior, clean restrained low-noise metal panels and subtle yellow floor markings. Crisp lightly pixel-stylized game texture, muted cool blue-gray palette, soft contact shadows, few white recessed lights. No units, vehicles, ships, characters, text, logos, UI. Keep center empty. Unit maintenance bay: moderately sized square floor panels, recessed maintenance tracks at sides, compact mechanical service fixtures around perimeter, sparse yellow parking alignment strokes. Clear central 65 percent to place unit. No raised foreground railing or wall blocking frame.

舰船图：

Use case: stylized-concept. Asset: landscape 4:3 background for a game inventory card, behind a small unit sprite. STRICT ORTHOGRAPHIC TOP-DOWN / BIRD'S EYE VIEW, camera points vertically down at floor, no horizon, no visible room wall faces, no ceiling. Inspired by reference's enclosed blue-gray industrial sci-fi maintenance interior, clean restrained low-noise metal panels and subtle yellow floor markings. Crisp lightly pixel-stylized game texture, muted cool blue-gray palette, soft contact shadows, few white recessed lights. No units, vehicles, ships, characters, text, logos, UI. Keep center empty. GIGANTIC enclosed spaceship dock floor: broad uninterrupted dark steel plates with very long widely separated embedded guide rails and distant tiny maintenance fixtures at extreme edges, subtle docking geometry conveys huge scale and much more spacious area than a small unit workshop. Clear central 85 percent. Low visual density. No large objects or obstructions.
