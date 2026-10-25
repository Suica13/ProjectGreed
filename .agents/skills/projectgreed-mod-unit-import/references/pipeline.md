# 入口与刷新边界

路径均相对仓库根目录。原源目录在 `tools/mod_source.py` 的 `MOD/ROOT/MAIN` 定义；迁移机器时先确认路径有效。

| 位置 | 职责 |
| --- | --- |
| `assets/units/<ID>/unit.json`、同级 `textures/` | 预制体、骨骼、图层、武器、套件及贴图 |
| `assets/unit-catalog.json` | 运行时目录、规则、地图引用 |
| `assets/animations/`、`assets/effects/`、`assets/sounds/` | 共用演出资源；实际引用由加载器校验 |
| `tools/mod_source.py` | 只读解析和继承解析；导入模块本身不应写文件 |
| `tools/import-0079-page-one.py` | Page_00 构造器 `build(row,effects)` 和批量导入入口 |
| `tools/page_one_adaptations.py`、`tools/native_weapon_layout.py` | 平台差异、套件归类、隐藏装备、炮塔与图层纠正 |
| `tools/native_combat.py` | 原资源与武器实际流程、发数、载荷和扣能；不能把声明的 EN 宏当成实际消费 |
| `tools/weapon_policy.py`、`tools/v05_balance.py` | 战术射程、技能政策、COST/占地/补给；文件名带版本不代表已废弃 |
| `tools/native_presentation.py`、`tools/native_movement_effects.py` | 持握/射击显示、炮管层级、原生气垫和系统特效 |
| `tools/paired_weapons.py`、`tools/paired-weapons.cjs` | 声明物理枪口分组，在加载阶段合成同时射击的运行时流程 |
| `tools/native_conversions.py`、`tools/import-conversion-forms.py` | 形态/脱出配置与必要衍生预制体 |
| `tools/load-catalog.cjs` | 完整资源、部位、套件、流程、转换目标校验 |
| `shared/rules.js`、`shared/weapon-sequence.js`、`shared/unit-parts.js` | 共享服务器裁定和攻击步骤/部位规则 |
| `client/renderer.js`、`client/map-combat.js` | 实际图层/枪口采样与大地图战斗演出 |

## 选择操作

- 新增一个单位：先用源 `core.name` 确认 ID，组装构造器 row（id/name/faction/tags/source），用 `build` 生成；合并 effects 和 catalog，再通过加载器后才暴露目录。不要执行整批命令替代单体导入。
- 刷新现有武器政策：`python tools/refresh_weapon_skills.py`。覆盖全部单位的政策字段；开始前检查未提交修改，完成后审阅差异。
- 衍生形态：检查 `tools/import-conversion-forms.py` 的显式清单再运行；生成后会刷新武器政策。
- 只重新扫描已手动加入的普通 JSON：`npm run units:reload` 或项目现有 BAT。它不读取原 MOD。
- 报告：`python tools/report-page-one.py`、`python tools/report-weapon-timing.py`。前者维护移植状态，后者是原生武器时间统计，不等于当前合并武器的 UI 清单。

## 核对顺序

1. `node -e "require('./tools/load-catalog.cjs').loadCatalog()"`
2. `python tools/audit-native-combat.py`：需要原 MOD；校验原始资源和武器流程，不校验渲染效果。
3. 按改动运行相关 `node --test tests/<name>.test.cjs`；共享规则改动运行 `npm test`。
4. `npm run build`；相关 `npx playwright test tests/<name>.spec.cjs`。重点单元测试：`paired-weapons`、`conversions`、`ship-arcs`、`native-combat`；浏览器参照 `native-layout`、`conversions`、`muzzle-effects`。

不要为消除测试失败而重新采用过时手调伤害。先确认测试验证的是现行原生契约还是已被用户覆盖的旧政策。不要删除仍有调用方的旧版本脚本或回归测试。
