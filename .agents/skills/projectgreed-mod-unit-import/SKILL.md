---
name: projectgreed-mod-unit-import
description: 移植、修复或核对 ProjectGreed 的 Rusted Warfare Battle Universe 原 MOD 单位，包括素材、武器流程、数值换算、左右武器、炮塔模块和衍生形态；用于本仓库的单位工作，不用于直接修改原 MOD。
---

# ProjectGreed 原 MOD 单位移植

在仓库根目录工作，先读 `AGENTS.md`。本 skill 保存在项目内，随仓库维护；本次用户指令优先于这里记录的转换规则。

## 工作流

1. 明确单位 ID、来源与目标范围。用 `tools/mod_source.py` 读取原 INI/GW 及 `copyFrom` 继承；沿实际 `alsoTriggerAction`、排队动作、炮口和附件追踪，不按文件名或第一段宏猜测最终结果。原 MOD 仅作为读取源。
2. 选一个相同平台的现有预制体对照。入口、数据位置和刷新边界见 [pipeline.md](references/pipeline.md)；武器射程/AP、移动力与视野的换算及例外见 [conversion-rules.md](references/conversion-rules.md)。批量导入器会覆盖多个单位；单单位任务应调用其构造函数或限定目标，避免无关再导入。
3. 输出普通 JSON 和本地素材。保持来源 ID、中文显示名分离，骨骼用部件名；保留 `source`、`sourceStats`、`nativeTiming`。不用 `memory.*` 或 `self.resource` 作为运行时表达式。不明确的武器名记录到 `武器命名待确认.md`。
4. 区分主武器套件、固定/通用副武器、驾驶员解锁、可换装副武器。驾驶员属性门槛由 `native_pilot_weapons.py` 转为 `pilotRequirements`，使用实际驾驶员属性校验；未实现的驾驶员条件和可换装副武器仍隐藏并保留来源/原因；不要把每个源武器都变成一个套件。旧套件通过 `kitAliases` 迁移。
5. 左右同类武器、模块炮塔和形态转换按 [mechanics.md](references/mechanics.md) 处理。尚未实现的机制写 `mechanics.status=review`，不要只加按钮或以特效冒充功能完成。
6. 对每项数值并列核对原生值、导入基础值、政策覆盖值和最终运行值。修改负责生成数据的政策/导入代码，再刷新受影响 JSON；仅改生成结果会在下次刷新时丢失。按当次用户允许的范围核对与验证；改源码后 `npm run build` 更新网页。

## 换算检查

- 单位 EN 上限统一为原生 `enMax × 0.5`，包括所有衍生形态；用 `tools/unit_energy.py` 记录减半前基值并避免重复减半。用户指定例外 `MS_06C` 最终 EN 为350，优先于通用倍率。武器 EN 消耗继续按原生发射链计算。

- 武器：原 GW 发射链决定载荷、发数、伤害分量和实际扣能；格子射程与 AP 看 `tools/weapon_policy.py` 最终覆盖。分别核对 `min/max/actionCost`、伤害、命中和 EN，不能只按 `limitingRange`、武器名或旧 JSON 推断。
- 移动：以原版 BoostSpeed 对应的常规推进字段 `boostMoveSpeed` 为基础评估移动格数，再加普通单位或战舰的战术加成；不要混用闪避加速 `onDodgeBoostSpeed` 或临时 `extraBoostSpeed`。旧单位可能有显式平衡基值。核对 `sourceStats.boostSpeed`、`sourceStats.tacticalMoveBeforeBonus`、`stats.move`，并区分地图地形与适应性造成的实际可达距离。
- 视野：沿用独立换算：原生雾视距 ×0.4，原生雷达距离 ÷36，反侦测距离仍 ÷28.8。读继承及初始化动作后的最终原生值；雷达探测不等于可见或可攻击。不得把普通雷达约为视距 1.25 倍的结果当成所有单位的统一公式。
- 有用户指定的战术数值时，以用户要求为准；在生成政策中记录例外及理由。详细公式、覆盖顺序和现行特例见 [conversion-rules.md](references/conversion-rules.md)。

## 验收

- 能编组、部署、移动、计划攻击、应战、结算、死亡；AI 能按适应性、预算、完整占地选择它。衍生形态的 `formOnly` 必须正确。
- 数值对齐与战术改编分开报告：原生 HP/EN/护盾、伤害分量/发数/EN 由源码审计；格子射程、移动力、视野和回合技能由项目政策决定，不能用旧手调值覆盖原值。
- 视觉检查包括眼睛、炮塔、枪口、持握/射击状态、左右肢体破损、推进器、命中和所属环境死亡特效；静态数据通过不等于视觉正确。
- 网络只同步服务器裁定的状态和事件；保留并行应战及所有观察者演出完成屏障。修改共享规则时验证主客机路径。
- 说明实际检查及未验证项。构建网页不等于打包；仅在用户要求时生成 ZIP、部署或提交推送。

## 当前AP与射程断言（2026-10-31）

- 普通单位原生转向换算为 `max(10, 10 + round(2 * log2(baseTurnSpeed / 1.75)))`；战舰固定10点基础AP，部署形态使用母体转向。只用 `tools/unit_action_mobility.py` 刷新，不重导无关素材。
- 机体机动AP倍率为 `max(1, 1+(机动-100)*0.005)`；驾驶员AP倍率为 `max(0.5, 1+(机动-100)*0.004)`；最终AP为基础AP乘两者后按0.5点四舍五入。反应继续只影响回避。
- 所有武器最终AP为源战术费用按现有分类政策处理后统一乘2；由 `shared/conversion-rules.json` 的 `weapons.ap=2` 控制。导入JSON与共用武器库保留未翻倍的基准，禁止同时翻倍源数值。照射、摄像枪、光束扰乱膜等武器技能同样适用；维修、补给、驾驶员技能等辅助技能不翻倍。
- 普通武器最大射程加1；狙击与蓄力狙击最大射程加2，替代普通+1而不叠加。最小射程不变，包括原有小数距离。旧狙击导入层已加过2格，本轮是在该现有值上再加2；勿改旧常量后再次叠加。
- 全局AP和射程规则只应用一次，在人工数值差值之前执行；重新移植与重新构建不得重复翻倍或重复加射程。开发者换算规则页面沿用同一配置。
- 对此类移植和调整必须运行 `node --test tests/ap-range-conversion.test.cjs tests/action-mobility.test.cjs tests/pilot-mobility-ratio.test.cjs`：逐一核对全部编译武器的AP×2、普通射程+1、两类狙击+2、最小射程与原生载荷不变，另核对队列扣费/取消返还、驾驶员机动增益和部署形态。


### 2026-10-31 武器与半点AP修订

头部火神炮（Common_DoubleVulcan_MS）与腕部枪炮（Common_ArmBR/GL/MG/MS）最终3 AP、射程1–2，不套用通用AP×2与射程+1；不包含腕装军刀、胸部火神炮或飞机机炮。迫击炮基础命中×1.10（不是增加10个百分点），分段命中同步。实弹及光束火箭筒统一伤害×1.25，不叠加光束步枪倍率；光束步枪仍为×1.5，FA-78-1双管步枪每管5000→7500，合计15000。原生载荷与发数不变。上述规则在人工数值差值之前应用，配置见 `shared/conversion-rules.json`。

最终AP＝`round(基础AP × max(1,1+(机体机动−100)×0.005) × max(0.5,1+(驾驶员机动−100)×0.004) × 2) / 2`，最低1 AP。通用武器AP费用、反击预算、EMP惩罚、出击及母舰损毁扣费也按0.5点四舍五入；攻击计划扣费与取消返还保留半点。反应不参与AP换算。追加断言：`tests/head-wrist-mortar-bazooka.test.cjs`。


## 武器标签与分类覆盖

- 分类以 `shared/weapon-classes.js` 为唯一显示／换算入口；可选 `weaponClass` 覆盖自动识别。旧category不再是运行时平衡分类的唯一依据。新增武器必须能得到有效标签；腕部军刀、飞机火神炮、头部火神炮和腕部枪炮不得混为一类。
- 用户手动分类保存在通用模板或单位武器覆盖中，修改时保留原MOD载荷、发数、伤害属性和演出。伤害倍率、机枪费用、头部／腕部固定范围、迫击炮命中与狙击额外射程均读取同一分类。
- 规则参考 [武器分类与换算规则](../../../武器分类与换算规则.md)。补充运行 `node --test tests/weapon-classes.test.cjs tests/weapon-balance.test.cjs tests/ap-range-conversion.test.cjs`，确认分类覆盖、无数值烘焙、原生数据保留、错误分类事务回滚和已有数值兼容。


## 当前两级武器分类（覆盖前文单层分类说明）

- 主分类为主手、身体、腕部、头部、内藏、腿部；子分类为光束、机枪、火箭筒等20种种类。使用 `weaponMainClass` / `weaponSubClass` 覆盖，旧weaponClass只兼容读取。LegR右腿、LegL左腿，导入名称政策由native_weapon_names.py维护。
- 默认主手光束伤害×1.5，腕部光束×0.75，其余部位光束×1；各部位继承机枪×0.75、火箭筒×1.25、近战×1.10、迫击炮命中×1.10。冲撞不吃近战加成。腕部光束枪不叠加主手光束倍率，最终伤害仍按25取整。
- `shared/conversion-rules.json` schemaVersion=2，分类规则位于weaponClasses.<main>.<sub>，包含基础AP/EN/命中/最小最大射程（-1继承）及伤害、AP、EN、命中、射程倍率与最大射程增减。使用同一分类应用规则，不将派生数值烘焙回原始载荷。
- 必须核对用户点名的BD-1胸部有线导弹、陆战型高达胸部火神炮、魔蟹内藏光束枪、腿部导弹与左右腕枪。运行 `node --test tests/weapon-hierarchy.test.cjs tests/weapon-classes.test.cjs tests/weapon-balance.test.cjs tests/ap-range-conversion.test.cjs`。
