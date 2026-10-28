# MS、舰船例外列表

核对基准：**V38 / `08ade63`，2026-10-29**。覆盖当前注册 MS、`stats.ship=true` 舰船及与它们有关的运输平台；单位显示名与稳定 ID 同时保留。

本表是查询和维护登记，不参与构建。数值以当前单位 JSON 和加载后的规则为准；新增或修改例外时，应同时维护生成政策、对应单位文件及本表。原生专属技能不自动视为数值例外；特殊形态、源码中的定点修正和待适配项目分别列出。

## 1. 通用规则与覆盖顺序

- 基础 COST：原 MOD `unitLevel × 0.25`，按25取最近值，最低25；武器套件 COST 另加。下表中的 COST 均指基础 COST。
- EN 容量：原生 EN ×0.5；武器 EN 消耗不一起减半。普通耐久按基础值×1.25、500点取最近值；以下显式覆盖优先。
- 普通移动力加1，舰船加3；地形、适应性和驾驶员仍会影响实战可达范围。
- 所有舰船武器基础命中率×0.9；舰船对空炮2 AP，每炮口攻击次数减半、奇数向上取整。非防空加农炮最大射程额外+3，非防空迫击炮额外+1。
- 舰船雷达探测可触发 `revealOnDetection`；这不是某一艘船的单独特例。AI 的战舰优先席位以50%概率保留，也不是单舰 COST 修正。
- 导入期间的旧模板可能先写入临时值，最终会再经过原生载荷恢复和武器／平衡政策；不要把中间值当成现行特例。

完整换算说明：[conversion-rules.md](.agents/skills/projectgreed-mod-unit-import/references/conversion-rules.md)。

## 2. 明确保留的数值例外

| 单位 | 项目 | 当前规则／数值 | 维护入口 |
|---|---|---|---|
| [扎古II C型](assets/units/MS_06C/unit.json)（`MS_06C`） | 基础 COST | 固定500；用户指定例外。 | [v05_balance.py](tools/v05_balance.py#L12) |
| [老虎特装型](assets/units/MS_07B3/unit.json)（`MS_07B3`） | 基础 COST | 固定375；用户指定例外。 | [v05_balance.py](tools/v05_balance.py#L13) |
| [扎古II C型](assets/units/MS_06C/unit.json)（`MS_06C`） | EN 上限 | 固定350，覆盖原生EN减半公式；保留350 EN核弹使用条件。 | [unit_energy.py](tools/unit_energy.py#L5) |
| [哥伦布级](assets/units/ColumbusClass/unit.json)（`ColumbusClass`）、[巴布亚级](assets/units/PapuaClass/unit.json)（`PapuaClass`） | 基础 COST | 固定250；原500减半。最终由补给政策覆盖，防止重新导入恢复旧价。 | [unit_supply.py](tools/unit_supply.py#L9) |
| [姆塞级](assets/units/MusaiClass/unit.json)（`MusaiClass`）、[法梅尔级](assets/units/FalmerClass/unit.json)（`FalmerClass`） | 耐久 | 通用耐久处理后的值×0.85，再以500为单位向上取整；保存 shipHullBeforeReduction，不能重复打折。 | [unit_ship_balance.py](tools/unit_ship_balance.py#L8) |
| [姆塞级](assets/units/MusaiClass/unit.json)（`MusaiClass`）、[法梅尔级](assets/units/FalmerClass/unit.json)（`FalmerClass`） | 光束炮伤害 | 仅 beam 类型且武器ID包含 beamcannon 的武器：基础伤害分量×0.85，各分量按500向上取整，再求和。不是全武器伤害下降15%。 | [unit_ship_balance.py](tools/unit_ship_balance.py#L16) |
| [萨拉米斯级](assets/units/SalamisClass/unit.json)（`SalamisClass`）、[麦哲伦级](assets/units/MagellanClass/unit.json)（`MagellanClass`）、[麦哲伦级[指挥舰]](assets/units/MagellanClass_Green/unit.json)（`MagellanClass_Green`） | 模块炮台伤害 | 具有 moduleId/moduleIds 的武器载荷×1.25；保留原生载荷备份，再独立应用舰船命中修正。 | [weapon_policy.py](tools/weapon_policy.py#L117) |
| [加乌级](assets/units/GawClass/unit.json)（`GawClass`） | 航空炸弹伤害 | 炸弹载荷×1.25；其他单位的炸弹通用倍率为×1.5。 | [v17_balance.py](tools/v17_balance.py#L87) |

### 已回归通用 COST，勿继续当作例外

| 单位 | 当前基础 COST | 说明 |
|---|---:|---|
| [扎尼](assets/units/RFF_06/unit.json)（`RFF_06`） | 100 | 按原 MOD Level 换算；旧手工价格已取消，套件附加COST另计。 |
| [格鲁古古](assets/units/MS_14A/unit.json)（`MS_14A`） | 375 | 按原 MOD Level 换算；旧手工价格已取消，套件附加COST另计。 |
| [高达NT-1](assets/units/RX_78NT_1/unit.json)（`RX_78NT_1`） | 875 | 按原 MOD Level 换算；旧手工价格已取消，套件附加COST另计。 |
| [高达NT-1［全装甲］](assets/units/RX_78NT_1_FA/unit.json)（`RX_78NT_1_FA`） | 875 | 按原 MOD Level 换算；旧手工价格已取消，套件附加COST另计。 |

## 3. MS 武器、部位和套件特例

| 单位／范围 | 现行处理 | 维护入口 |
|---|---|---|
| [扎古II C型](assets/units/MS_06C/unit.json)（`MS_06C`） | ZN_MS_06C_Bombing_Nuke 是核弹技能：3–8格、圆形半径3、30000基础实弹伤害、5 AP、每条命1次，不允许反击；原生EN消费单独保留。 | [weapon_policy.py](tools/weapon_policy.py#L169) |
| [大魔](assets/units/MS_09/unit.json)（`MS_09`）、[大魔热带式样](assets/units/MS_09D/unit.json)（`MS_09D`）、[大魔F](assets/units/MS_09F/unit.json)（`MS_09F`）、[大魔热带型](assets/units/MS_09F_TROP/unit.json)（`MS_09F_TROP`）、[大魔热带型[0083]](assets/units/MS_09F_TROP_0083/unit.json)（`MS_09F_TROP_0083`）、[多瓦吉](assets/units/MS_09G/unit.json)（`MS_09G`）、[力克大魔](assets/units/MS_09R/unit.json)（`MS_09R`）、[力克大魔II](assets/units/MS_09R2/unit.json)（`MS_09R2`）、[多瓦兹](assets/units/MS_09S/unit.json)（`MS_09S`）、[培曾·多瓦吉](assets/units/MS_10/unit.json)（`MS_10`）、[大魔高速实验型](assets/units/YMS_09J/unit.json)（`YMS_09J`） | 共用 ZN_MS_09_ChestBeam 的胸部扩散炮固定1–1格，不能按普通光束枪射程覆盖。 | [weapon_policy.py](tools/weapon_policy.py#L261) |
| [扎古II J型](assets/units/MS_06J/unit.json)（`MS_06J`） | 腿部导弹任一腿完好即可使用（anyParts），不是必须双腿完好。 | [unit_parts.py](tools/unit_parts.py#L33) |
| [扎古加农](assets/units/MS_06K/unit.json)（`MS_06K`） | BigGun 任一手臂完好即可使用（anyParts）。 | [unit_parts.py](tools/unit_parts.py#L35) |
| [陆战型高达](assets/units/RX_79_G/unit.json)（`RX_79_G`） | Common_SingleVulcan_RX_79_G 是胸部武器，不要求头部完好；通用冲撞也不强制依赖头部。 | [unit_parts.py](tools/unit_parts.py#L37) |
| [钢加农](assets/units/RX_77_2/unit.json)（`RX_77_2`） | 迫击炮依赖背包，不切换持枪；导弹套件移除加农炮迫击炮分支，肩部加农炮／导弹贴图随套件切换。RX_77_3、RX_77_3D 的迫击炮也采用背包依赖与不切持枪规则（这两台已注册）。 | [native_presentation.py](tools/native_presentation.py#L124) |
| [吉姆加农](assets/units/RGC_80/unit.json)（`RGC_80`） | 迫击炮继承 Common_Cannon 的部位依赖和炮口，不切换持枪。 | [weapon_policy.py](tools/weapon_policy.py#L273) |
| [精灵高达](assets/units/RX_78XX/unit.json)（`RX_78XX`） | EF_75mmMG_Double 双75mm机枪为左右同时开火特例；其他双臂同类武器默认独立通道。 | [paired_weapons.py](tools/paired_weapons.py#L100) |
| [苍白骑兵](assets/units/RX_80PR_2/unit.json)（`RX_80PR_2`）、[苍白骑兵 [HADES]](assets/units/RX_80PR_2_HADES/unit.json)（`RX_80PR_2_HADES`） | kit_0 固定命名“复合发射器套件”；一般只有一个武器组的单位统一叫“标准套件”。 | [native_weapon_layout.py](tools/native_weapon_layout.py#L169) |

## 4. 特殊形态、爆甲和脱出

以下是当前 JSON 中实际挂载的技能，不把只留下原 MOD 来源、尚未实现的脱出算作完成。转换还受共用部位、行动、搭载等条件限制。

| 单位 | 技能／目标 | 资源与行动特例 | 维护入口 |
|---|---|---|---|
| [全装甲高达](assets/units/FA_78_1/unit.json)（`FA_78_1`） | 爆甲 → [全装甲高达［去甲］](assets/units/FA_78_1_NA/unit.json)（`FA_78_1_NA`） | 继承原资源比例；HP/EN额外恢复35%/35%；不全修部位；结束行动。 | [native_conversions.py](tools/native_conversions.py) |
| [全装甲高达［去甲］](assets/units/FA_78_1_NA/unit.json)（`FA_78_1_NA`） | 脱出 → [核心战斗机](assets/units/FF_X7/unit.json)（`FF_X7`） | 脱出移除原机体；HP/EN额外恢复100%/100%；修复全部部位；结束行动。 | [native_conversions.py](tools/native_conversions.py) |
| [伊芙利特改](assets/units/MS_08TX_Kai/unit.json)（`MS_08TX_Kai`） | EXAM → [伊芙利特改 [EXAM]](assets/units/MS_08TX_Kai_EXAM/unit.json)（`MS_08TX_Kai_EXAM`） | 激活消耗25%最大EN，不结束行动；duration=3，每个己方回合结束扣25%最大HP、5%最大EN；派生形态沿用主体HP/EN/护盾与COST，机动至少×1.35、命中至少×1.2、移动至少+1，武器额外倍率由生成脚本处理。 | [special_systems.py](tools/special_systems.py) |
| [钢坦克](assets/units/RX_75/unit.json)（`RX_75`） | 脱出 → [核心战斗机](assets/units/FF_X7/unit.json)（`FF_X7`） | 脱出移除原机体；HP/EN额外恢复100%/100%；修复全部部位；结束行动。 | [page_one_adaptations.py](tools/page_one_adaptations.py) |
| [钢加农](assets/units/RX_77_2/unit.json)（`RX_77_2`） | 脱出 → [核心战斗机](assets/units/FF_X7/unit.json)（`FF_X7`） | 脱出移除原机体；HP/EN额外恢复100%/100%；修复全部部位；结束行动。 | [page_one_adaptations.py](tools/page_one_adaptations.py) |
| [高达NT-1［全装甲］](assets/units/RX_78NT_1_FA/unit.json)（`RX_78NT_1_FA`） | 爆甲 → [高达NT-1](assets/units/RX_78NT_1/unit.json)（`RX_78NT_1`） | 继承原资源比例；HP/EN额外恢复35%/35%；不全修部位；结束行动。 | [native_conversions.py](tools/native_conversions.py) |
| [试作型高达](assets/units/RX_78_1/unit.json)（`RX_78_1`） | 脱出 → [核心战斗机](assets/units/FF_X7/unit.json)（`FF_X7`） | 脱出移除原机体；HP/EN额外恢复100%/100%；修复全部部位；结束行动。 | [page_one_adaptations.py](tools/page_one_adaptations.py) |
| [高达](assets/units/RX_78_2/unit.json)（`RX_78_2`） | 脱出 → [核心战斗机](assets/units/FF_X7/unit.json)（`FF_X7`） | 脱出移除原机体；HP/EN额外恢复100%/100%；修复全部部位；结束行动。 | [page_one_adaptations.py](tools/page_one_adaptations.py) |
| [苍蓝宿命一号机](assets/units/RX_79_BD_1/unit.json)（`RX_79_BD_1`） | EXAM → [苍蓝宿命一号机 [EXAM]](assets/units/RX_79_BD_1_EXAM/unit.json)（`RX_79_BD_1_EXAM`） | 激活消耗25%最大EN，不结束行动；duration=3，每个己方回合结束扣25%最大HP、5%最大EN；派生形态沿用主体HP/EN/护盾与COST，机动至少×1.35、命中至少×1.2、移动至少+1，武器额外倍率由生成脚本处理。 | [special_systems.py](tools/special_systems.py) |
| [苍蓝宿命二号机](assets/units/RX_79_BD_2/unit.json)（`RX_79_BD_2`） | EXAM → [苍蓝宿命二号机 [EXAM]](assets/units/RX_79_BD_2_EXAM/unit.json)（`RX_79_BD_2_EXAM`） | 激活消耗25%最大EN，不结束行动；duration=3，每个己方回合结束扣25%最大HP、5%最大EN；派生形态沿用主体HP/EN/护盾与COST，机动至少×1.35、命中至少×1.2、移动至少+1，武器额外倍率由生成脚本处理。 | [special_systems.py](tools/special_systems.py) |
| [陆战型高达[武器货柜]](assets/units/RX_79_G_WithBackpack/unit.json)（`RX_79_G_WithBackpack`） | 爆甲 → [陆战型高达](assets/units/RX_79_G/unit.json)（`RX_79_G`） | 继承原资源比例；HP/EN额外恢复0%/0%；不全修部位；结束行动。 | [native_conversions.py](tools/native_conversions.py) |
| [苍白骑士](assets/units/RX_80PR/unit.json)（`RX_80PR`） | HADES → [苍白骑士 [HADES]](assets/units/RX_80PR_HADES/unit.json)（`RX_80PR_HADES`） | 激活消耗25%最大EN，不结束行动；duration=3，每个己方回合结束扣25%最大HP、5%最大EN；派生形态沿用主体HP/EN/护盾与COST，机动至少×1.35、命中至少×1.2、移动至少+1，武器额外倍率由生成脚本处理。 | [special_systems.py](tools/special_systems.py) |
| [苍白骑兵](assets/units/RX_80PR_2/unit.json)（`RX_80PR_2`） | HADES → [苍白骑兵 [HADES]](assets/units/RX_80PR_2_HADES/unit.json)（`RX_80PR_2_HADES`） | 激活消耗25%最大EN，不结束行动；duration=3，每个己方回合结束扣25%最大HP、5%最大EN；派生形态沿用主体HP/EN/护盾与COST，机动至少×1.35、命中至少×1.2、移动至少+1，武器额外倍率由生成脚本处理。 | [special_systems.py](tools/special_systems.py) |
| [苍白骑士[陆战重装备规格]](assets/units/RX_80PR_GroundType/unit.json)（`RX_80PR_GroundType`） | HADES → [苍白骑士[陆战重装备规格] [HADES]](assets/units/RX_80PR_GroundType_HADES/unit.json)（`RX_80PR_GroundType_HADES`） | 激活消耗25%最大EN，不结束行动；duration=3，每个己方回合结束扣25%最大HP、5%最大EN；派生形态沿用主体HP/EN/护盾与COST，机动至少×1.35、命中至少×1.2、移动至少+1，武器额外倍率由生成脚本处理。 | [special_systems.py](tools/special_systems.py) |
| [苍白骑士[宇宙战规格]](assets/units/RX_80PR_SpaceType/unit.json)（`RX_80PR_SpaceType`） | HADES → [苍白骑士[宇宙战规格] [HADES]](assets/units/RX_80PR_SpaceType_HADES/unit.json)（`RX_80PR_SpaceType_HADES`） | 激活消耗25%最大EN，不结束行动；duration=3，每个己方回合结束扣25%最大HP、5%最大EN；派生形态沿用主体HP/EN/护盾与COST，机动至少×1.35、命中至少×1.2、移动至少+1，武器额外倍率由生成脚本处理。 | [special_systems.py](tools/special_systems.py) |
| [斗狼](assets/units/YMT_05/unit.json)（`YMT_05`） | 变形 → [斗狼［形态B］](assets/units/YMT_05_ModeB/unit.json)（`YMT_05_ModeB`） | 继承原资源比例；HP/EN额外恢复0%/0%；不全修部位；结束行动。 | [native_conversions.py](tools/native_conversions.py) |
| [斗狼［形态B］](assets/units/YMT_05_ModeB/unit.json)（`YMT_05_ModeB`） | 变形 → [斗狼](assets/units/YMT_05/unit.json)（`YMT_05`） | 继承原资源比例；HP/EN额外恢复0%/0%；不全修部位；结束行动。 | [native_conversions.py](tools/native_conversions.py) |

## 5. 舰船占地与补给特例

下列是生成政策中的显式占地分组，**不是全部现有JSON已经一致的声明**；部分早期舰船当前保留1×3，偏差见下一节及逐舰表。以船头朝向为基准记录宽×长；实战旋转会交换轴向，显示比例不等于占地。

| 单位／范围 | 基准占地 | 维护入口 |
|---|---|---|
| [飞马级](assets/units/PegasusClass/unit.json)（`PegasusClass`）、[桑吉巴尔级](assets/units/ZanzibarClass/unit.json)（`ZanzibarClass`） | 3×6 | [v05_balance.py](tools/v05_balance.py#L17) |
| [盖洛普级](assets/units/GallopClass/unit.json)（`GallopClass`）、[小托盘级](assets/units/MiniTrayClass/unit.json)（`MiniTrayClass`） | 1×2 | [v05_balance.py](tools/v05_balance.py#L17) |
| 其他 stats.ship=true 单位 | 2×3 | [v05_balance.py](tools/v05_balance.py#L17) |

EN补给的指定单位：[米迪亚](assets/units/Medea/unit.json)（`Medea`）、[米迪亚改](assets/units/MedeaKai/unit.json)（`MedeaKai`）、[胖叔叔](assets/units/FatUncle/unit.json)（`FatUncle`）、[胖叔叔改](assets/units/FatUncleKai/unit.json)（`FatUncleKai`）、[哥伦布级](assets/units/ColumbusClass/unit.json)（`ColumbusClass`）、[巴布亚级](assets/units/PapuaClass/unit.json)（`PapuaClass`）。消耗自身25%最大EN与2 AP，恢复一台正交相邻友军50%最大EN，每个己方回合一次；不等于普通格纳库每回合维修。维护：[unit_supply.py](tools/unit_supply.py)。

米迪亚 `Medea`、胖叔叔 `FatUncle` 的 `_Turret_MG` 额外按防空机枪处理：1–2格、2 AP，触发舰船防空发数减半。改型是否命中该规则取决于实际武器ID／rangeRole，不能只凭名称推广。维护：[weapon_policy.py](tools/weapon_policy.py#L285)。

### 当前保留的移动基值、占地与适应性差异

此组记录当前数据与参考公式／生成政策的差异，方便日后刷新前复核；不能据此认定每项差异都是用户单独指定的平衡值。本次只登记，不擅自统一这些数据。

| MS | 原生boostMoveSpeed | 基础移动公式结果 | 当前保留基础值 | 当前JSON移动 |
|---|---:|---:|---:|---:|
| [大魔](assets/units/MS_09/unit.json)（`MS_09`） | 1.8 | 6 | 7 | 8 |
| [力克大魔](assets/units/MS_09R/unit.json)（`MS_09R`） | 1.45 | 5 | 7 | 8 |
| [格鲁古古](assets/units/MS_14A/unit.json)（`MS_14A`） | 1.5 | 5 | 6 | 7 |
| [轻装吉姆](assets/units/RGM_79L/unit.json)（`RGM_79L`） | 1.65 | 6 | 7 | 8 |
| [陆战型吉姆](assets/units/RGM_79_G/unit.json)（`RGM_79_G`） | 1.25 | 4 | 5 | 6 |

基础移动公式为 `clamp(round(5×boostMoveSpeed÷1.4),3,9)`；保留基值由 `sourceStats.tacticalMoveBeforeBonus` 记录，[weapon_policy.py](tools/weapon_policy.py)在此基础上添加常规移动加成。特殊系统派生形态另按第4节管理。

**当前占地偏差（共20艘）**：[大托盘级](assets/units/BigTrayClass/unit.json)（`BigTrayClass`）、[伯克级驱逐舰](assets/units/BurkeClass/unit.json)（`BurkeClass`）、[契贝级](assets/units/ChivvayClass/unit.json)（`ChivvayClass`）、[哥伦布级](assets/units/ColumbusClass/unit.json)（`ColumbusClass`）、[达布德级](assets/units/DabudeClass/unit.json)（`DabudeClass`）、[法梅尔级](assets/units/FalmerClass/unit.json)（`FalmerClass`）、[加乌级](assets/units/GawClass/unit.json)（`GawClass`）、[格瓦金级](assets/units/GwazineClass/unit.json)（`GwazineClass`）、[重叉级](assets/units/HeavyForkClass/unit.json)（`HeavyForkClass`）、[喜马拉雅级](assets/units/HimalayaClass/unit.json)（`HimalayaClass`）、[尤顿海姆级](assets/units/JotunheimClass/unit.json)（`JotunheimClass`）、[M型潜水艇](assets/units/M_Type_Submarine/unit.json)（`M_Type_Submarine`）、[魔鲨级](assets/units/M_Type_Submarine_ZEON/unit.json)（`M_Type_Submarine_ZEON`）、[麦哲伦级](assets/units/MagellanClass/unit.json)（`MagellanClass`）、[麦哲伦级[指挥舰]](assets/units/MagellanClass_Green/unit.json)（`MagellanClass_Green`）、[姆塞级](assets/units/MusaiClass/unit.json)（`MusaiClass`）、[巴布亚级](assets/units/PapuaClass/unit.json)（`PapuaClass`）、[萨拉米斯级](assets/units/SalamisClass/unit.json)（`SalamisClass`）、[U型潜艇](assets/units/U_Type_Submarine/unit.json)（`U_Type_Submarine`）、[尤康级](assets/units/U_Type_Submarine_ZEON/unit.json)（`U_Type_Submarine_ZEON`）。这些条目JSON为1×3，而 `v05_balance.py` 对它们的默认值为2×3；若完整刷新平衡政策，存在占地改变风险。应先确认保留现状还是调整生成政策，不直接用旧导入器说明覆盖当前文件。

**地面／宇宙适应性兼容值**：`native_mobility.py` 对 ground/space 使用 `setdefault`，会保留旧值；非宇宙专用舰船、地面MS的50%宇宙适应性等由导入时的战术兼容规则产生。以下按“原MOD记录→当前JSON”分组，排除特殊系统派生形态，以免把该兼容组误当作完全原生数值。

| 环境 | 原MOD记录 → 当前JSON | 当前单位 |
|---|---|---|
| 地面 | 10% → 0% | [伯明翰级](assets/units/BirminghamClass/unit.json)（`BirminghamClass`）、[契贝级](assets/units/ChivvayClass/unit.json)（`ChivvayClass`）、[契贝级改](assets/units/ChivvayClassKai/unit.json)（`ChivvayClassKai`）、[哥伦布级](assets/units/ColumbusClass/unit.json)（`ColumbusClass`）、[哥伦布级改](assets/units/ColumbusClassKai/unit.json)（`ColumbusClassKai`）、[法梅尔级](assets/units/FalmerClass/unit.json)（`FalmerClass`）、[格万赞级](assets/units/GwanzanClass/unit.json)（`GwanzanClass`）、[格瓦金级](assets/units/GwazineClass/unit.json)（`GwazineClass`）、[尤顿海姆级](assets/units/JotunheimClass/unit.json)（`JotunheimClass`）、[麦哲伦级](assets/units/MagellanClass/unit.json)（`MagellanClass`）、[麦哲伦级改](assets/units/MagellanClassKai/unit.json)（`MagellanClassKai`）、[麦哲伦级后期型](assets/units/MagellanClassLateType/unit.json)（`MagellanClassLateType`）、[麦哲伦级[指挥舰]](assets/units/MagellanClass_Green/unit.json)（`MagellanClass_Green`）、[姆塞级](assets/units/MusaiClass/unit.json)（`MusaiClass`）、[姆塞级后期型](assets/units/MusaiClassLateType/unit.json)（`MusaiClassLateType`）、[姆塞级后期型[0083]](assets/units/MusaiClassLateType_0083/unit.json)（`MusaiClassLateType_0083`）、[巴布亚级](assets/units/PapuaClass/unit.json)（`PapuaClass`）、[帕佐克级](assets/units/PazockClass/unit.json)（`PazockClass`）、[萨拉米斯级](assets/units/SalamisClass/unit.json)（`SalamisClass`）、[萨拉米斯级改](assets/units/SalamisClassKai/unit.json)（`SalamisClassKai`）、[萨拉米斯级后期型](assets/units/SalamisClassLateType/unit.json)（`SalamisClassLateType`） |
| 地面 | 10% → 100% | [阿鲁比昂](assets/units/AlbionClass/unit.json)（`AlbionClass`）、[加乌级](assets/units/GawClass/unit.json)（`GawClass`）、[灰色幽灵级](assets/units/GrayPhantomClass/unit.json)（`GrayPhantomClass`）、[飞马级](assets/units/PegasusClass/unit.json)（`PegasusClass`）、[桑吉巴尔级](assets/units/ZanzibarClass/unit.json)（`ZanzibarClass`）、[桑吉巴尔级改](assets/units/ZanzibarClassKai/unit.json)（`ZanzibarClassKai`）、[桑吉巴尔级改[0083]](assets/units/ZanzibarClassKai_0083/unit.json)（`ZanzibarClassKai_0083`） |
| 地面 | 25% → 50% | [力克大魔](assets/units/MS_09R/unit.json)（`MS_09R`） |
| 宇宙 | 10% → 0% | [伯克级驱逐舰](assets/units/BurkeClass/unit.json)（`BurkeClass`）、[喜马拉雅级](assets/units/HimalayaClass/unit.json)（`HimalayaClass`）、[M型潜水艇](assets/units/M_Type_Submarine/unit.json)（`M_Type_Submarine`）、[魔鲨级](assets/units/M_Type_Submarine_ZEON/unit.json)（`M_Type_Submarine_ZEON`）、[U型潜艇](assets/units/U_Type_Submarine/unit.json)（`U_Type_Submarine`）、[尤康级](assets/units/U_Type_Submarine_ZEON/unit.json)（`U_Type_Submarine_ZEON`） |
| 宇宙 | 10% → 50% | [大托盘级](assets/units/BigTrayClass/unit.json)（`BigTrayClass`）、[达布德级](assets/units/DabudeClass/unit.json)（`DabudeClass`）、[盖洛普级](assets/units/GallopClass/unit.json)（`GallopClass`）、[加乌级](assets/units/GawClass/unit.json)（`GawClass`）、[重叉级](assets/units/HeavyForkClass/unit.json)（`HeavyForkClass`）、[扎古坦克](assets/units/MS_06V/unit.json)（`MS_06V`）、[大魔](assets/units/MS_09/unit.json)（`MS_09`）、[大魔热带式样](assets/units/MS_09D/unit.json)（`MS_09D`）、[大魔F](assets/units/MS_09F/unit.json)（`MS_09F`）、[大魔热带型](assets/units/MS_09F_TROP/unit.json)（`MS_09F_TROP`）、[大魔热带型[0083]](assets/units/MS_09F_TROP_0083/unit.json)（`MS_09F_TROP_0083`）、[多瓦吉](assets/units/MS_09G/unit.json)（`MS_09G`）、[大魔加农一型](assets/units/MS_09_K_1/unit.json)（`MS_09_K_1`）、[大魔加农二型](assets/units/MS_09_K_2/unit.json)（`MS_09_K_2`）、[吉刚](assets/units/MS_12/unit.json)（`MS_12`）、[小托盘级](assets/units/MiniTrayClass/unit.json)（`MiniTrayClass`）、[钢坦克II](assets/units/RMV_1/unit.json)（`RMV_1`）、[强袭型钢坦克](assets/units/RTX_440/unit.json)（`RTX_440`）、[量产型钢坦克](assets/units/RX_75R/unit.json)（`RX_75R`）、[精灵高达](assets/units/RX_78XX/unit.json)（`RX_78XX`）、[大魔高速实验型](assets/units/YMS_09J/unit.json)（`YMS_09J`）、[扎梅尔](assets/units/YMS_16M/unit.json)（`YMS_16M`）、[斗狼](assets/units/YMT_05/unit.json)（`YMT_05`） |
| 宇宙 | 25% → 50% | [全装甲高达陆战型](assets/units/FA_78_G/unit.json)（`FA_78_G`）、[战蟹](assets/units/MSM_03/unit.json)（`MSM_03`）、[高战蟹](assets/units/MSM_03C/unit.json)（`MSM_03C`）、[亚凯](assets/units/MSM_04/unit.json)（`MSM_04`）、[玖阿格](assets/units/MSM_04G/unit.json)（`MSM_04G`）、[阿格盖](assets/units/MSM_04N/unit.json)（`MSM_04N`）、[魔蟹](assets/units/MSM_07/unit.json)（`MSM_07`）、[实验型魔蟹](assets/units/MSM_07E/unit.json)（`MSM_07E`）、[魔蟹[指挥官机]](assets/units/MSM_07S/unit.json)（`MSM_07S`）、[佐寇克](assets/units/MSM_08/unit.json)（`MSM_08`）、[索克](assets/units/MSM_10/unit.json)（`MSM_10`）、[扎古沙漠型](assets/units/MS_06D/unit.json)（`MS_06D`）、[扎古II陆战高机动型](assets/units/MS_06G/unit.json)（`MS_06G`）、[扎古II J型](assets/units/MS_06J/unit.json)（`MS_06J`）、[扎古半加农](assets/units/MS_06JK/unit.json)（`MS_06JK`）、[水中型扎古](assets/units/MS_06M/unit.json)（`MS_06M`）、[老虎 A型](assets/units/MS_07A/unit.json)（`MS_07A`）、[老虎 B型](assets/units/MS_07B/unit.json)（`MS_07B`）、[老虎特装型](assets/units/MS_07B3/unit.json)（`MS_07B3`）、[老虎飞行实验型](assets/units/MS_07H/unit.json)（`MS_07H`）、[老虎飞行型](assets/units/MS_07H8/unit.json)（`MS_07H8`）、[伊芙利特](assets/units/MS_08TX/unit.json)（`MS_08TX`）、[伊芙利特改](assets/units/MS_08TX_Kai/unit.json)（`MS_08TX_Kai`）、[水中型吉姆](assets/units/RAG_79/unit.json)（`RAG_79`）、[水中型高达](assets/units/RAG_79_G1/unit.json)（`RAG_79_G1`）、[吉姆寒冷地带式样](assets/units/RGM_79D/unit.json)（`RGM_79D`）、[装甲强化型吉姆](assets/units/RGM_79FD/unit.json)（`RGM_79FD`）、[吉姆打击型](assets/units/RGM_79FP/unit.json)（`RGM_79FP`）、[吉姆突击型](assets/units/RGM_79G/unit.json)（`RGM_79G`）、[吉姆 斯巴达](assets/units/RGM_79S/unit.json)（`RGM_79S`）、[沙漠型吉姆](assets/units/RGM_79_D/unit.json)（`RGM_79_D`）、[陆战型吉姆](assets/units/RGM_79_G/unit.json)（`RGM_79_G`）、[吉姆狙击型](assets/units/RGM_79_G_SP/unit.json)（`RGM_79_G_SP`）、[陆战型吉姆[武器货柜]](assets/units/RGM_79_G_WithBackpack/unit.json)（`RGM_79_G_WithBackpack`）、[钢加农重装型D](assets/units/RX_77_3D/unit.json)（`RX_77_3D`）、[苍蓝宿命一号机](assets/units/RX_79_BD_1/unit.json)（`RX_79_BD_1`）、[陆战型高达](assets/units/RX_79_G/unit.json)（`RX_79_G`）、[陆战型高达[武器货柜]](assets/units/RX_79_G_WithBackpack/unit.json)（`RX_79_G_WithBackpack`）、[苍白骑士[陆战重装备规格]](assets/units/RX_80PR_GroundType/unit.json)（`RX_80PR_GroundType`） |

维护入口：[native_mobility.py](tools/native_mobility.py)、[page_one_adaptations.py](tools/page_one_adaptations.py)、[import-additional-units.py](tools/import-additional-units.py)及各单位 `stats.adaptability`；这些兼容值不是自动补偿武器伤害或移动距离的理由。

### 当前全部舰船查询表

下表穷举当前 `stats.ship=true` 条目；标记“通用”表示没有上述单舰额外数值覆盖，不表示该舰没有原生特殊武装或格纳库。HP、EN和移动为无驾驶员／环境增益的JSON值。

| 单位 | 基础COST | HP | EN | 移动 | 占地 | 单舰数值例外 |
|---|---:|---:|---:|---:|---|---|
| [阿鲁比昂](assets/units/AlbionClass/unit.json)（`AlbionClass`） | 2250 | 281500 | 15000 | 8 | 2×3 | 通用 |
| [大托盘级](assets/units/BigTrayClass/unit.json)（`BigTrayClass`） | 1000 | 125000 | 4500 | 6 | 1×3 | 通用 |
| [伯明翰级](assets/units/BirminghamClass/unit.json)（`BirminghamClass`） | 2000 | 281500 | 7500 | 7 | 2×3 | 通用 |
| [伯克级驱逐舰](assets/units/BurkeClass/unit.json)（`BurkeClass`） | 250 | 37500 | 1000 | 7 | 1×3 | 通用 |
| [契贝级](assets/units/ChivvayClass/unit.json)（`ChivvayClass`） | 1000 | 112500 | 6000 | 6 | 1×3 | 通用 |
| [契贝级改](assets/units/ChivvayClassKai/unit.json)（`ChivvayClassKai`） | 1250 | 175000 | 7500 | 6 | 2×3 | 通用 |
| [哥伦布级](assets/units/ColumbusClass/unit.json)（`ColumbusClass`） | 250 | 62500 | 7500 | 6 | 1×3 | COST=250、EN补给 |
| [哥伦布级改](assets/units/ColumbusClassKai/unit.json)（`ColumbusClassKai`） | 750 | 106500 | 15000 | 7 | 2×3 | 通用 |
| [达布德级](assets/units/DabudeClass/unit.json)（`DabudeClass`） | 1000 | 156500 | 4500 | 6 | 1×3 | 通用 |
| [法梅尔级](assets/units/FalmerClass/unit.json)（`FalmerClass`） | 625 | 69500 | 2500 | 7 | 1×3 | 耐久／光束炮×0.85并取整 |
| [盖洛普级](assets/units/GallopClass/unit.json)（`GallopClass`） | 500 | 56500 | 3000 | 6 | 1×2 | 通用 |
| [加乌级](assets/units/GawClass/unit.json)（`GawClass`） | 750 | 75000 | 3750 | 7 | 1×3 | 炸弹倍率1.25 |
| [灰色幽灵级](assets/units/GrayPhantomClass/unit.json)（`GrayPhantomClass`） | 1875 | 175000 | 11250 | 7 | 2×3 | 通用 |
| [格万赞级](assets/units/GwanzanClass/unit.json)（`GwanzanClass`） | 2000 | 281500 | 9000 | 7 | 2×3 | 通用 |
| [格瓦金级](assets/units/GwazineClass/unit.json)（`GwazineClass`） | 1500 | 187500 | 9000 | 6 | 1×3 | 通用 |
| [重叉级](assets/units/HeavyForkClass/unit.json)（`HeavyForkClass`） | 1250 | 187500 | 4500 | 6 | 1×3 | 通用 |
| [喜马拉雅级](assets/units/HimalayaClass/unit.json)（`HimalayaClass`） | 1000 | 156500 | 7500 | 6 | 1×3 | 通用 |
| [尤顿海姆级](assets/units/JotunheimClass/unit.json)（`JotunheimClass`） | 500 | 75000 | 11250 | 6 | 1×3 | 通用 |
| [M型潜水艇](assets/units/M_Type_Submarine/unit.json)（`M_Type_Submarine`） | 1000 | 150000 | 4500 | 7 | 1×3 | 通用 |
| [魔鲨级](assets/units/M_Type_Submarine_ZEON/unit.json)（`M_Type_Submarine_ZEON`） | 1000 | 150000 | 4500 | 7 | 1×3 | 通用 |
| [麦哲伦级](assets/units/MagellanClass/unit.json)（`MagellanClass`） | 1000 | 87500 | 3750 | 6 | 1×3 | 模块炮台伤害×1.25 |
| [麦哲伦级改](assets/units/MagellanClassKai/unit.json)（`MagellanClassKai`） | 1500 | 181500 | 7500 | 7 | 2×3 | 通用 |
| [麦哲伦级后期型](assets/units/MagellanClassLateType/unit.json)（`MagellanClassLateType`） | 1250 | 125000 | 7500 | 6 | 2×3 | 通用 |
| [麦哲伦级[指挥舰]](assets/units/MagellanClass_Green/unit.json)（`MagellanClass_Green`） | 1250 | 125000 | 3750 | 6 | 1×3 | 模块炮台伤害×1.25 |
| [小托盘级](assets/units/MiniTrayClass/unit.json)（`MiniTrayClass`） | 500 | 56500 | 3000 | 6 | 1×2 | 通用 |
| [姆塞级](assets/units/MusaiClass/unit.json)（`MusaiClass`） | 500 | 59000 | 3000 | 7 | 1×3 | 耐久／光束炮×0.85并取整 |
| [姆塞级后期型](assets/units/MusaiClassLateType/unit.json)（`MusaiClassLateType`） | 750 | 119000 | 6250 | 8 | 2×3 | 通用 |
| [姆塞级后期型[0083]](assets/units/MusaiClassLateType_0083/unit.json)（`MusaiClassLateType_0083`） | 875 | 137500 | 6000 | 8 | 2×3 | 通用 |
| [巴布亚级](assets/units/PapuaClass/unit.json)（`PapuaClass`） | 250 | 62500 | 15000 | 6 | 1×3 | COST=250、EN补给 |
| [帕佐克级](assets/units/PazockClass/unit.json)（`PazockClass`） | 750 | 106500 | 15000 | 7 | 2×3 | 通用 |
| [飞马级](assets/units/PegasusClass/unit.json)（`PegasusClass`） | 1500 | 125000 | 9000 | 7 | 3×6 | 通用 |
| [萨拉米斯级](assets/units/SalamisClass/unit.json)（`SalamisClass`） | 500 | 75000 | 2250 | 7 | 1×3 | 模块炮台伤害×1.25 |
| [萨拉米斯级改](assets/units/SalamisClassKai/unit.json)（`SalamisClassKai`） | 875 | 144000 | 6000 | 8 | 2×3 | 通用 |
| [萨拉米斯级后期型](assets/units/SalamisClassLateType/unit.json)（`SalamisClassLateType`） | 750 | 125000 | 6000 | 8 | 2×3 | 通用 |
| [U型潜艇](assets/units/U_Type_Submarine/unit.json)（`U_Type_Submarine`） | 500 | 94000 | 3000 | 7 | 1×3 | 通用 |
| [尤康级](assets/units/U_Type_Submarine_ZEON/unit.json)（`U_Type_Submarine_ZEON`） | 500 | 94000 | 3000 | 7 | 1×3 | 通用 |
| [桑吉巴尔级](assets/units/ZanzibarClass/unit.json)（`ZanzibarClass`） | 1500 | 125000 | 9000 | 7 | 3×6 | 通用 |
| [桑吉巴尔级改](assets/units/ZanzibarClassKai/unit.json)（`ZanzibarClassKai`） | 1875 | 200000 | 11250 | 8 | 2×3 | 通用 |
| [桑吉巴尔级改[0083]](assets/units/ZanzibarClassKai_0083/unit.json)（`ZanzibarClassKai_0083`） | 2250 | 281500 | 15000 | 8 | 2×3 | 通用 |

## 6. SFS、开发与禁用状态

- SFS 平台：[核心推进器](assets/units/FF_X7Bst/unit.json)（`FF_X7Bst`）、[喷气核心推进器](assets/units/FFB_7Bst/unit.json)（`FFB_7Bst`）、[德戴 YS](assets/units/DodaiYS/unit.json)（`DodaiYS`）、[爆裂炮](assets/units/Burstliner/unit.json)（`Burstliner`）、[斯科尔](assets/units/Skiure/unit.json)（`Skiure`）。每个原生槽位搭载一台MS，按1槽计算，覆盖普通格纳库按 transport.slotCost 计容量的方式；槽位位置取原MOD x/y/height。SFS乘员可见、独立攻击和受击、不提供舰内维修。来源：[native_hangars.py](tools/native_hangars.py)、[shared/hangars.js](shared/hangars.js)。
- [高达试作2号机](assets/units/RX_78GP02A/unit.json)（`RX_78GP02A`）：一个机体与库存条目，availableFactions 同时包含 EFSF、ZEON，两边各自科技均可解锁；不是复制成两台独立机体。维护：[unit_eras.py](tools/unit_eras.py)。
- 原 GP 计划／星辰作战对应条目标记0083；其余按最早出现页标为0079E／0079L，衍生形态跟随母体。不是把所有第二页单位一律标为0079L。维护：[unit_eras.py](tools/unit_eras.py)。
- 目前第二页科技入口隐藏，单位、科技关系和存档ID保留；详见[第二页清单](0079第二页移植清单.md)。
- 阿普萨拉斯是 MA，附录保留以防漏查：[阿普萨拉斯II](assets/units/ApsarasII/unit.json)（`ApsarasII`）。`Apsaras*` 统一WIP禁用，编组可见但不能出战／被AI选择。唯一名单入口：[assets/unit-wip.json](assets/unit-wip.json)。

## 7. 显示与移植定点修正（不改变基础 COST）

| 单位 | 修正内容 | 维护入口 |
|---|---|---|
| [培曾·多瓦吉](assets/units/MS_10/unit.json)（`MS_10`） | 导弹贴图由原生装备／攻击状态选帧，不按时间循环。 | [native_presentation.py](tools/native_presentation.py#L8) |
| [试作型高达](assets/units/RX_78_1/unit.json)（`RX_78_1`） | 军刀／标枪共享显示索引，额外根据当前武器区分，避免同时显示。 | [native_presentation.py](tools/native_presentation.py#L16) |
| [精灵高达](assets/units/RX_78XX/unit.json)（`RX_78XX`） | 左右匕首贴图由普通和驾驶员专属连段共用；格斗大于145解锁专属连段，左臂损毁单独控制。 | [native_presentation.py](tools/native_presentation.py#L24) |
| [钢坦克](assets/units/RX_75/unit.json)（`RX_75`）、[量产型钢坦克](assets/units/RX_75R/unit.json)（`RX_75R`） | 炮管图层放在车体上方；RMV_1、RTX_440也共用此修正。 | [native_presentation.py](tools/native_presentation.py#L84) |
| [力克大魔](assets/units/MS_09R/unit.json)（`MS_09R`） | 原MOD资料目录使用MS_09，不能按MS_09R单独目录猜测来源。 | [unit_parts.py](tools/unit_parts.py#L12) |

### 旧模板兼容组

以下是旧导入模板组，仍参与共用武器模板和避免重复补发子弹的兼容逻辑：

[吉姆](assets/units/RGM_79/unit.json)（`RGM_79`）、[吉姆加农](assets/units/RGC_80/unit.json)（`RGC_80`）、[轻装吉姆](assets/units/RGM_79L/unit.json)（`RGM_79L`）、[扎古II F型](assets/units/MS_06F/unit.json)（`MS_06F`）、[大魔](assets/units/MS_09/unit.json)（`MS_09`）、[陆战型吉姆](assets/units/RGM_79_G/unit.json)（`RGM_79_G`）、[扎古II J型](assets/units/MS_06J/unit.json)（`MS_06J`）、[扎古加农](assets/units/MS_06K/unit.json)（`MS_06K`）、[格鲁古古](assets/units/MS_14A/unit.json)（`MS_14A`）、[陆战型高达](assets/units/RX_79_G/unit.json)（`RX_79_G`）、[扎古II F2后期型](assets/units/MS_06F2/unit.json)（`MS_06F2`）、[力克大魔](assets/units/MS_09R/unit.json)（`MS_09R`）、[萨拉米斯级](assets/units/SalamisClass/unit.json)（`SalamisClass`）、[试作型高达](assets/units/RX_78_1/unit.json)（`RX_78_1`）、[核心战斗机](assets/units/FF_X7/unit.json)（`FF_X7`）。

维护：[page_one_adaptations.py](tools/page_one_adaptations.py#L10)、[native_weapon_layout.py](tools/native_weapon_layout.py#L7)。**这些ID不是继续保留旧伤害、旧命中或旧COST的授权**；最终仍会进入原生武器恢复和现行平衡政策。

## 8. 待适配与隐藏武装（不等于已生效特例）

- [高达试作2号机](assets/units/RX_78GP02A/unit.json)（`RX_78GP02A`） 的核弹与 [大扎姆](assets/units/MA_08/unit.json)（`MA_08`） 的高耗能环形武装：原生消费超过本项目减半后的EN容量，隐藏对应可用套件／武器入口，保留来源与 review 记录。没有沿用扎古II C的EN特例给这些单位自动扩容。维护：[page_two_adaptations.py](tools/page_two_adaptations.py)。
- [共和国级](assets/units/PublicClass/unit.json)（`PublicClass`） 的光束扰乱膜区域效果尚待适配，保留飞弹直接伤害。维护：[page_two_adaptations.py](tools/page_two_adaptations.py)。
- 浮游兵器部署、远程操控、回收及其他未适配技能以各机体 mechanics.status=review 为准。以下列出当前MS／舰船的review来源ID，不能以出现贴图或文本判定已实现。

| 单位 | 当前 review 项目ID |
|---|---|
| [阿鲁比昂](assets/units/AlbionClass/unit.json)（`AlbionClass`） | `special_Common_ReEntry`、`special_Common_ReEntry_FromSpace`、`special_Common_ReEntry_Both` |
| [大托盘级](assets/units/BigTrayClass/unit.json)（`BigTrayClass`） | `special_Common_MinovskyParticle_M` |
| [伯明翰级](assets/units/BirminghamClass/unit.json)（`BirminghamClass`） | `special_Common_ReEntry_NeedBooster` |
| [契贝级](assets/units/ChivvayClass/unit.json)（`ChivvayClass`） | `CustomUnit_NewUnit`、`special_Common_MinovskyParticle_M`、`special_Common_ReEntry_NeedBooster` |
| [契贝级改](assets/units/ChivvayClassKai/unit.json)（`ChivvayClassKai`） | `special_Common_ReEntry_NeedBooster` |
| [哥伦布级](assets/units/ColumbusClass/unit.json)（`ColumbusClass`） | `special_Common_ReEntry_NeedBooster` |
| [哥伦布级改](assets/units/ColumbusClassKai/unit.json)（`ColumbusClassKai`） | `special_Common_ReEntry_NeedBooster` |
| [达布德级](assets/units/DabudeClass/unit.json)（`DabudeClass`） | `special_Common_MinovskyParticle_M` |
| [全装甲高达](assets/units/FA_78_1/unit.json)（`FA_78_1`） | `CustomUnit` |
| [全装甲高达［去甲］](assets/units/FA_78_1_NA/unit.json)（`FA_78_1_NA`） | `CustomUnit` |
| [重高达](assets/units/FA_78_2/unit.json)（`FA_78_2`） | `CustomUnit` |
| [全装甲高达七号机](assets/units/FA_78_3/unit.json)（`FA_78_3`） | `ExitUnit`、`CustomUnit` |
| [全装甲高达陆战型](assets/units/FA_78_G/unit.json)（`FA_78_G`） | `CustomUnit` |
| [法梅尔级](assets/units/FalmerClass/unit.json)（`FalmerClass`） | `special_Common_MinovskyParticle_M` |
| [盖洛普级](assets/units/GallopClass/unit.json)（`GallopClass`） | `special_Common_MinovskyParticle_M` |
| [加乌级](assets/units/GawClass/unit.json)（`GawClass`） | `DogFight_A`、`special_Common_MinovskyParticle_M` |
| [灰色幽灵级](assets/units/GrayPhantomClass/unit.json)（`GrayPhantomClass`） | `special_Common_ReEntry`、`special_Common_ReEntry_FromSpace`、`special_Common_ReEntry_Both` |
| [格万赞级](assets/units/GwanzanClass/unit.json)（`GwanzanClass`） | `special_Common_ReEntry_NeedBooster` |
| [格瓦金级](assets/units/GwazineClass/unit.json)（`GwazineClass`） | `special_Common_MinovskyParticle_M`、`special_Common_ReEntry_NeedBooster` |
| [重叉级](assets/units/HeavyForkClass/unit.json)（`HeavyForkClass`） | `special_Common_MinovskyParticle_M` |
| [魔蟹](assets/units/MSM_07/unit.json)（`MSM_07`） | `CustomUnit` |
| [吉翁号](assets/units/MSN_02/unit.json)（`MSN_02`） | `ExitUnit_NewUnit`、`remote_weapon_ZN_MSN_02_HandFunnel` |
| [扎古II C型](assets/units/MS_06C/unit.json)（`MS_06C`） | `CustomUnit_NewUnit` |
| [扎古强行侦查型](assets/units/MS_06E/unit.json)（`MS_06E`） | `CustomUnit` |
| [扎古II[布雷者]](assets/units/MS_06F_MineLayer/unit.json)（`MS_06F_MineLayer`） | `special_Common_MineLauncher_Continuous_Back_Space` |
| [扎古II狙击型](assets/units/MS_06F_Sniper/unit.json)（`MS_06F_Sniper`） | `CustomUnit` |
| [扎古II高机动型R-1](assets/units/MS_06R_1/unit.json)（`MS_06R_1`） | `CustomUnit` |
| [扎古II高机动型R-2](assets/units/MS_06R_2/unit.json)（`MS_06R_2`） | `CustomUnit` |
| [扎古II S型](assets/units/MS_06S/unit.json)（`MS_06S`） | `CustomUnit` |
| [扎古坦克](assets/units/MS_06V/unit.json)（`MS_06V`） | `Deploy` |
| [老虎 A型](assets/units/MS_07A/unit.json)（`MS_07A`） | `CustomUnit` |
| [老虎 B型](assets/units/MS_07B/unit.json)（`MS_07B`） | `CustomUnit` |
| [伊芙利特改 [EXAM]](assets/units/MS_08TX_Kai_EXAM/unit.json)（`MS_08TX_Kai_EXAM`） | `Exam_On` |
| [大魔热带式样](assets/units/MS_09D/unit.json)（`MS_09D`） | `CustomUnit` |
| [大魔热带型](assets/units/MS_09F_TROP/unit.json)（`MS_09F_TROP`） | `CustomUnit` |
| [大魔加农一型](assets/units/MS_09_K_1/unit.json)（`MS_09_K_1`） | `CustomUnit` |
| [机动扎古](assets/units/MS_11/unit.json)（`MS_11`） | `CustomUnit` |
| [勇士高机动型](assets/units/MS_14B/unit.json)（`MS_14B`） | `CustomUnit` |
| [勇士J型](assets/units/MS_14JG/unit.json)（`MS_14JG`） | `CustomUnit` |
| [勇士指挥官型](assets/units/MS_14S/unit.json)（`MS_14S`） | `CustomUnit` |
| [M型潜水艇](assets/units/M_Type_Submarine/unit.json)（`M_Type_Submarine`） | `ChangeStyle` |
| [魔鲨级](assets/units/M_Type_Submarine_ZEON/unit.json)（`M_Type_Submarine_ZEON`） | `ChangeStyle` |
| [麦哲伦级](assets/units/MagellanClass/unit.json)（`MagellanClass`） | `CustomUnit_NewUnit`、`special_Common_MinovskyParticle_M`、`special_Common_ReEntry_NeedBooster` |
| [麦哲伦级改](assets/units/MagellanClassKai/unit.json)（`MagellanClassKai`） | `special_Common_ReEntry_NeedBooster` |
| [麦哲伦级后期型](assets/units/MagellanClassLateType/unit.json)（`MagellanClassLateType`） | `special_Common_ReEntry_NeedBooster` |
| [麦哲伦级[指挥舰]](assets/units/MagellanClass_Green/unit.json)（`MagellanClass_Green`） | `CustomUnit_NewUnit`、`special_Common_MinovskyParticle_M`、`special_Common_ReEntry_NeedBooster` |
| [小托盘级](assets/units/MiniTrayClass/unit.json)（`MiniTrayClass`） | `special_Common_MinovskyParticle_M` |
| [姆塞级](assets/units/MusaiClass/unit.json)（`MusaiClass`） | `CustomUnit_NewUnit`、`special_Common_MinovskyParticle_M`、`special_Common_ReEntry_NeedBooster` |
| [姆塞级后期型](assets/units/MusaiClassLateType/unit.json)（`MusaiClassLateType`） | `special_Common_ReEntry_NeedBooster` |
| [姆塞级后期型[0083]](assets/units/MusaiClassLateType_0083/unit.json)（`MusaiClassLateType_0083`） | `special_Common_ReEntry_NeedBooster` |
| [巴布亚级](assets/units/PapuaClass/unit.json)（`PapuaClass`） | `special_Common_ReEntry_NeedBooster` |
| [帕佐克级](assets/units/PazockClass/unit.json)（`PazockClass`） | `special_Common_ReEntry_NeedBooster` |
| [飞马级](assets/units/PegasusClass/unit.json)（`PegasusClass`） | `special_Common_MinovskyParticle_M`、`special_Common_ReEntry`、`special_Common_ReEntry_FromSpace`、`special_Common_ReEntry_Both` |
| [吉姆改](assets/units/RGM_79C/unit.json)（`RGM_79C`） | `CustomUnit` |
| [吉姆打击型](assets/units/RGM_79FP/unit.json)（`RGM_79FP`） | `ExitUnit` |
| [吉姆突击型](assets/units/RGM_79G/unit.json)（`RGM_79G`） | `CustomUnit` |
| [吉姆突击型[宇宙式样]](assets/units/RGM_79G_Space/unit.json)（`RGM_79G_Space`） | `CustomUnit` |
| [先行量产型吉姆(宇宙式样)](assets/units/RGM_79_G_SPACE/unit.json)（`RGM_79_G_SPACE`） | `CustomUnit` |
| [陆战型吉姆[武器货柜]](assets/units/RGM_79_G_WithBackpack/unit.json)（`RGM_79_G_WithBackpack`） | `UnloadEquipment` |
| [钢坦克II](assets/units/RMV_1/unit.json)（`RMV_1`） | `special_Common_SmokingLauncher_NowPos` |
| [强袭型钢坦克](assets/units/RTX_440/unit.json)（`RTX_440`） | `Transform_LandLand_Tank`、`special_Common_MineLauncher_Continuous_Back_Ground_RTX_440` |
| [量产型钢坦克](assets/units/RX_75R/unit.json)（`RX_75R`） | `Deploy` |
| [高达试作1号机](assets/units/RX_78GP01/unit.json)（`RX_78GP01`） | `CustomUnit`、`ExitUnit_NewUnit` |
| [高达试作1号机[FB]](assets/units/RX_78GP01_FB/unit.json)（`RX_78GP01_FB`） | `CustomUnit`、`ExitUnit_NewUnit` |
| [高达试作2号机](assets/units/RX_78GP02A/unit.json)（`RX_78GP02A`） | `energy_capacity_EF_RX_78GP02A_Bombing_Nuke` |
| [高达NT-1](assets/units/RX_78NT_1/unit.json)（`RX_78NT_1`） | `CustomUnit` |
| [枪手高达](assets/units/RX_78SP/unit.json)（`RX_78SP`） | `CustomUnit` |
| [精灵高达](assets/units/RX_78XX/unit.json)（`RX_78XX`） | `special_Common_ThunderStrike` |
| [高达](assets/units/RX_78_2/unit.json)（`RX_78_2`） | `CustomUnit`、`FuseUnit_B`、`special_Common_ReEntry_MS_FromSpace` |
| [G-3高达](assets/units/RX_78_3/unit.json)（`RX_78_3`） | `ExitUnit_NewUnit`、`special_Common_ReEntry_MS_FromSpace` |
| [高达4号机[Bst]](assets/units/RX_78_4_Bst/unit.json)（`RX_78_4_Bst`） | `CustomUnit` |
| [高达5号机[Bst]](assets/units/RX_78_5_Bst/unit.json)（`RX_78_5_Bst`） | `CustomUnit` |
| [高达7号机](assets/units/RX_78_7/unit.json)（`RX_78_7`） | `CustomUnit` |
| [苍蓝宿命一号机](assets/units/RX_79_BD_1/unit.json)（`RX_79_BD_1`） | `CustomUnit` |
| [苍蓝宿命一号机 [EXAM]](assets/units/RX_79_BD_1_EXAM/unit.json)（`RX_79_BD_1_EXAM`） | `Exam_On` |
| [苍蓝宿命二号机](assets/units/RX_79_BD_2/unit.json)（`RX_79_BD_2`） | `CustomUnit` |
| [苍蓝宿命二号机 [EXAM]](assets/units/RX_79_BD_2_EXAM/unit.json)（`RX_79_BD_2_EXAM`） | `Exam_On` |
| [陆战型高达[武器货柜]](assets/units/RX_79_G_WithBackpack/unit.json)（`RX_79_G_WithBackpack`） | `UnloadEquipment`、`CustomUnit` |
| [苍白骑兵 [HADES]](assets/units/RX_80PR_2_HADES/unit.json)（`RX_80PR_2_HADES`） | `HADES_PR2_On` |
| [苍白骑士[陆战重装备规格] [HADES]](assets/units/RX_80PR_GroundType_HADES/unit.json)（`RX_80PR_GroundType_HADES`） | `HADES_On` |
| [苍白骑士 [HADES]](assets/units/RX_80PR_HADES/unit.json)（`RX_80PR_HADES`） | `HADES_On` |
| [苍白骑士[宇宙战规格] [HADES]](assets/units/RX_80PR_SpaceType_HADES/unit.json)（`RX_80PR_SpaceType_HADES`） | `HADES_On` |
| [GLine](assets/units/RX_81/unit.json)（`RX_81`） | `CustomUnit` |
| [GLine 突击装甲型](assets/units/RX_81AS/unit.json)（`RX_81AS`） | `CustomUnit` |
| [GLine 完全特装型](assets/units/RX_81FC/unit.json)（`RX_81FC`） | `CustomUnit` |
| [GLine 轻装甲型](assets/units/RX_81LA/unit.json)（`RX_81LA`） | `CustomUnit` |
| [GLine 标准装甲型](assets/units/RX_81ST/unit.json)（`RX_81ST`） | `CustomUnit` |
| [萨拉米斯级改](assets/units/SalamisClassKai/unit.json)（`SalamisClassKai`） | `special_Common_ReEntry_NeedBooster` |
| [萨拉米斯级后期型](assets/units/SalamisClassLateType/unit.json)（`SalamisClassLateType`） | `special_Common_ReEntry_NeedBooster` |
| [U型潜艇](assets/units/U_Type_Submarine/unit.json)（`U_Type_Submarine`） | `ChangeStyle` |
| [尤康级](assets/units/U_Type_Submarine_ZEON/unit.json)（`U_Type_Submarine_ZEON`） | `ChangeStyle` |
| [强人](assets/units/YMS_15/unit.json)（`YMS_15`） | `CustomUnit`、`special_Common_MineLauncher_Continuous_Front_Space_YMS_15` |
| [强人艾欧斯](assets/units/YMS_15E/unit.json)（`YMS_15E`） | `special_Common_MineLauncher_Continuous_Front_Space_YMS_15` |
| [斗狼](assets/units/YMT_05/unit.json)（`YMT_05`） | `special_Common_SmokingLauncher_NowPos` |
| [桑吉巴尔级](assets/units/ZanzibarClass/unit.json)（`ZanzibarClass`） | `special_Common_MinovskyParticle_M`、`special_Common_ReEntry_NeedBooster`、`special_Common_ReEntry_FromSpace`、`special_Common_ReEntry_NeedBooster_Both` |
| [桑吉巴尔级改](assets/units/ZanzibarClassKai/unit.json)（`ZanzibarClassKai`） | `special_Common_ReEntry_NeedBooster`、`special_Common_ReEntry_FromSpace`、`special_Common_ReEntry_NeedBooster_Both` |
| [桑吉巴尔级改[0083]](assets/units/ZanzibarClassKai_0083/unit.json)（`ZanzibarClassKai_0083`） | `special_Common_ReEntry_NeedBooster`、`special_Common_ReEntry_FromSpace`、`special_Common_ReEntry_NeedBooster_Both` |

## 9. 源码定点分支查询索引

对 tools 下现行政策模块的 Python 条件与配置表进行交叉查询，仅列明确引用已注册 MS／舰船ID的分支；泛用分类规则不会出现在这里。此索引用于查漏，不能把错误处理、来源别名和显示修正都解释为数值增益。

| 文件 | 行号与涉及单位ID |
|---|---|
| [native_conversions.py](tools/native_conversions.py) | [L6](tools/native_conversions.py#L6) `FA_78_1`、`FA_78_1_NA`、`RX_78NT_1`、`RX_78NT_1_FA`、`RX_79_G`、`RX_79_G_WithBackpack`；[L28](tools/native_conversions.py#L28) `YMT_05`、`YMT_05_ModeB`；[L29](tools/native_conversions.py#L29) `YMT_05`、`YMT_05_ModeB`；[L30](tools/native_conversions.py#L30) `FA_78_1_NA`；[L36](tools/native_conversions.py#L36) `YMT_05`、`YMT_05_ModeB` |
| [native_movement_effects.py](tools/native_movement_effects.py) | [L125](tools/native_movement_effects.py#L125) `RMV_1` |
| [native_presentation.py](tools/native_presentation.py) | [L8](tools/native_presentation.py#L8) `MS_10`；[L16](tools/native_presentation.py#L16) `RX_78_1`；[L24](tools/native_presentation.py#L24) `RX_78XX`；[L84](tools/native_presentation.py#L84) `RMV_1`、`RTX_440`、`RX_75`、`RX_75R`；[L124](tools/native_presentation.py#L124) `RX_77_2` |
| [native_weapon_layout.py](tools/native_weapon_layout.py) | [L172](tools/native_weapon_layout.py#L172) `RX_80PR_2`、`RX_80PR_2_HADES` |
| [page_one_adaptations.py](tools/page_one_adaptations.py) | [L10](tools/page_one_adaptations.py#L10) `MS_06F`、`MS_06F2`、`MS_06J`、`MS_06K`、`MS_09`、`MS_09R`、`MS_14A`、`RGC_80`、`RGM_79`、`RGM_79L`、`RGM_79_G`、`RX_78_1`、`RX_79_G`、`SalamisClass`；[L66](tools/page_one_adaptations.py#L66) `RX_75`、`RX_77_2`、`RX_78_2`；[L108](tools/page_one_adaptations.py#L108) `MS_06E`、`RFF_06`；[L162](tools/page_one_adaptations.py#L162) `RX_75`、`RX_77_2`、`RX_78_2` |
| [page_two_adaptations.py](tools/page_two_adaptations.py) | [L29](tools/page_two_adaptations.py#L29) `RX_78GP02A` |
| [paired_weapons.py](tools/paired_weapons.py) | [L100](tools/paired_weapons.py#L100) `RX_78XX` |
| [unit_energy.py](tools/unit_energy.py) | [L5](tools/unit_energy.py#L5) `MS_06C` |
| [unit_parts.py](tools/unit_parts.py) | [L12](tools/unit_parts.py#L12) `MS_09`、`MS_09R` |
| [unit_ship_balance.py](tools/unit_ship_balance.py) | [L5](tools/unit_ship_balance.py#L5) `FalmerClass`、`MusaiClass` |
| [unit_supply.py](tools/unit_supply.py) | [L2](tools/unit_supply.py#L2) `ColumbusClass`、`PapuaClass`；[L8](tools/unit_supply.py#L8) `ColumbusClass`、`PapuaClass` |
| [v05_balance.py](tools/v05_balance.py) | [L12](tools/v05_balance.py#L12) `MS_06C`；[L13](tools/v05_balance.py#L13) `MS_07B3`；[L17](tools/v05_balance.py#L17) `GallopClass`、`MiniTrayClass`、`PegasusClass`、`ZanzibarClass` |
| [v17_balance.py](tools/v17_balance.py) | [L87](tools/v17_balance.py#L87) `GawClass` |
| [weapon_policy.py](tools/weapon_policy.py) | [L119](tools/weapon_policy.py#L119) `MagellanClass`、`MagellanClass_Green`、`SalamisClass`；[L266](tools/weapon_policy.py#L266) `RX_77_2`、`RX_77_3`、`RX_77_3D`；[L273](tools/weapon_policy.py#L273) `RGC_80` |

## 10. 后续维护约定

1. 新增例外先写清稳定单位ID、字段、适用武器／套件、覆盖公式、取整方式和原因，避免只记录中文名称或“降低15%”。
2. 修改负责生成该字段的 tools 政策，再更新目标 unit.json；只改生成后的JSON会被刷新覆盖。不要为了改一个特例批量重导无关单位。
3. 区分原MOD数值、通用战术换算、用户指定例外、尚待适配四种状态；已撤销的例外移到“已回归通用”区。
4. 修改例外后更新本表对应行、源码索引和当前值。新形态检查 formOf/formOnly、资源继承、套件映射与库存归属。
5. 本次仅整理文档，未改单位数值、战斗逻辑或生成页面；文档核对不代替后续功能改动所需的定向验证。

## 驾驶员属性武器

[驾驶员属性解锁武器](驾驶员属性解锁武器.md)列出全部30项及原 MOD 缺失流程例外。原生数值门槛严格比较，攻击、反击和AI共用服务端校验；其他隐藏换装不随之开放。

## 库存改装与新增脱出

改装价格及目标由 [单位改装路线](单位改装路线.md) 从原MOD生成，使用 `native_refits.py` 维护。每次原机体库存减1、目标库存加1，使用目标素体，独立套件库存保留。价格与库存同笔保存，原生开发条件保留。

RX-78-3→FF-X7、GP-01→核心战斗机II、GP-01FB→核心战斗机II FB、GP-03D→GP-03S、吉翁号→头部采用已有相邻格脱出规则，保留驾驶员。突击型吉姆→吉姆改、FA-78-3→RX-78-7采用原生爆甲转换。

RX-77-3两种炮塔贴图按套件显示；GP-02肩部推进器外壳静止／移动差分按移动状态显示，仍受对应手臂损坏限制。全体8项狙击蓄力的原生伤害及步骤载荷减半，EN、发数、AP不变。

### 爆裂炮（Burstliner）

自身照射技能必须有至少1台存活MS搭载在自身SFS槽位内才允许使用；乘员离机或阵亡后立即失效。已接入统一照射规则，不再作为普通攻击或反击武器。

## 照射、区域与异常状态（2026-10-29）

| 对象 | 现行规则 | 维护入口 |
| --- | --- | --- |
| `RX_78_4_Bst`、`ApsarasII`、`Burstliner`、`MA_08`、`AMX_002` | 方向照射；5 AP、50%最大EN、默认10格、基本命中60%、冷却3个己方回合；路径上每个机体各判定一次，包含友军。伤害为原MOD完整发射链总值的1/20，保留原生连续命中的衰减求和。 | `tools/native_irradiation.py`、`shared/rules.js` |
| 照射显示 | 原生蓄力与起点／中段／终点，PNG每帧宽高各减半并保留原生调色板及透明表；客户端拉伸中段，修改技能`range`即可适配长度，无辅助单位。蓄力和光束穿透迷雾显示，不公开未发现目标的HP。 | `tools/import-irradiation-assets.py`、`client/irradiation-fx.js` |
| `ApsarasII` | 从WIP清单解禁，3×3大型航空器；EMP：2 AP、保留原MOD80 EN，周围3格敌人下回合AP−1，重复不叠加，冷却2个己方回合。 | `tools/native_irradiation.py`、`assets/unit-wip.json` |
| `PublicClass` | 地格发射光束扰乱膜，4 AP、50%最大EN，半径4格，2个完整回合周期；射线路径经过区域时光束弹最终伤害减半，不叠加，不影响实弹或光束格斗。 | `tools/tactical_status.py` |
| 摄像枪 | 射程10～15格，3 AP，保留30 EN；目标半径3格视野及探测，至下个己方回合。 | `tools/native_recon.py` |
| 原生火焰武器 | 3 AP；命中后燃烧3个己方回合周期，服务端每秒扣除5%最大HP，SP百分比减免生效、固定减免不生效；规划与等待应战时继续计时，断线暂停，重复命中刷新持续期。 | `tools/tactical_status.py`、`shared/room-engine.js` |
| 电热鞭与所有`StunDamage`载荷 | 命中后目标下个己方回合AP−1，覆盖刷新、不叠加。 | `tools/tactical_status.py` |
| 红色推进层 | 仅在对应OverBoost／FullBoost／EXAM／HADES等技能启用时显示；普通移动与常驻航空／宇宙喷焰使用蓝色原图。 | `tools/native_movement_effects.py`、`client/renderer.js` |
| `RGM_79HC` | 完好盾与破损盾贴图按盾HP互斥；不再始终覆盖0耐久盾图。 | `tools/native_presentation.py` |

照射总伤害：`Σ(每步各伤害分量 × 发数 × 重复数 × 步骤倍率) × Σ(原生连续命中衰减倍率^i) ÷ 20`，其中`i=0…原生连续命中次数−1`。每个目标再应用现行驾驶员、护甲、盾牌及区域减伤规则。AI只朝可见敌人使用照射，并避开友军射线。

照射素材优化结果：12张序列图由825,643字节降至289,419字节（约减少65%），解码像素由13,378,752降至3,351,744（约减少75%）；导入时核对输出像素、调色板与透明表。

## 烟雾弹与I立场（2026-10-29）

- 烟雾弹：`Gunperry`、`RMV_1`、`YMT_05`沿原MOD已配置的发射器接入。消耗2 AP、100 EN，冷却3个己方回合；在发射时当前位置留下半径2格固定烟雾，持续到下个己方回合。区域内双方所有单位受到远程攻击时，最终命中率乘0.75；格斗不受影响，重叠不叠加，进出区域即时改变效果。白色烟雾位于战争迷雾及地面单位之上、航空器及其可见SFS乘员之下。
- `Skiure`与`Burstliner`使用统一照射技能；两者原生都有`SFS_CantAttack_Neutral`，必须有存活MS搭载在自己的SFS槽内才能发射。斯科尔原始载荷为单次发射，不人为补造原MOD不存在的连射次数。
- I立场：`MA_08`与`RX_78GP03D`容量250000，`AMX_002`容量275000；保留原MOD普通远程光束95%、贯穿光束50%的吸收比例。实弹、格斗光束及火焰不进入立场池。每次命中独立消耗立场耐久；最后一次拦截仍完整执行，可过载到最大容量的−25%，之后失效，恢复到正数时重新启用。预测不扣耐久，未命中不扣耐久，演出按弹着更新，保护部位破坏判定；AI强度同时缩放容量。
- I立场的实时恢复改编为每个己方回合恢复10%最大容量，含搭乘中单位；配置入口为`stats.iField.recoveryPercent`。原生`I_FieldRecoverSpeed=500`仍备份为`nativeRecoverySpeed`，便于日后重做换算。单位预览、生产能力栏和战斗信息均有说明，受击使用原生`I_Field_2`贴图。
- 维护入口：`tools/native_defensive_skills.py`、`tools/native_irradiation.py`、`shared/rules.js`。完整原始来源保留在单位JSON、原生载荷及生成政策中；冷却与持续期按己方回合周期换算，1个周期对应2次队伍交接。
