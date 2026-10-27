# 武器、移动力与视野换算核对

此页记录当前仓库的实际规则；执行时仍须核对代码与原 MOD 最终继承值。原 MOD 数值是来源记录，格子距离和 AP 是 ProjectGreed 的战术规则，两者量纲不同。

## 武器：发射流程与战术射程分开

1. 用 `tools/mod_source.py` 读取单位 INI、`copyFrom` 与武器 GW 的实际动作链。`tools/native_combat.py` 还原原生载荷、发数、伤害分量和实际扣能；`source`、`nativeTiming` 保留审计信息。声明的 EN 宏、炮口数或武器名称不能代替实际流程。
2. `tools/import-0079-page-one.py` 导入普通非格斗武器时，将最终炮塔 `limitingRange`（缺省用 `baseAttackRange`）约按 ÷100 转为初始最大格数，夹在 2–10；最小为 1。格斗是 1–1。这只是基础值，不是最终射程；未归类武器在政策中还可能按来源射程夹为 2–4。
3. `tools/weapon_policy.py` 当前通用格子射程：格斗 1–1、迫击炮 5–8、狙击 3–6、航空炸弹 1–2、核弹 3–8、火箭筒 2–4、普通加农炮 3–5、光束枪/光束步枪/机枪 2–3、导弹 3–4。战舰非防空加农炮最大射程再加 3，非防空迫击炮加 1；狙击蓄力最大射程为基础狙击武器最大射程 ×1.5 后向上取整。类别表不覆盖所有同名武器，尤其要核对 `rangeRole` 和单单位特例。
4. AP 独立计算，`action_cost` 的现行优先级：狙击 4；其他技能 5；指定头部火神炮 1；战舰导弹 2、战舰其他武器 3；短程副武器或指定手臂/胸/腿/内置武器 2；普通加农炮、迫击炮、机枪和炸弹 3；其余 2。之后仍可有特例：61 式与 61A5 主炮均为 2–4 格、2 AP，61A5 机枪为 1 AP。以最后写入的 `weapons[id].min/max/actionCost` 为准。
5. `projectile.speed` 是演出速度，不可换算为格子射程。射程、AP、伤害、命中、EN 和发数分别追踪来源。改平衡值时同时改生成政策与受影响 JSON，避免刷新后复原。

## 单位 EN 上限：统一减少50%

- 所有单位及衍生形态的最终 `stats.en = 原生 enMax × 0.5`。这是用户指定的战术政策，不是原 MOD 数值。已有单位以本次修改前的 EN 为基值统一减半。
- `tools/unit_energy.py` 统一实现该政策，`tools/native_combat.py::restore` 与共用属性入口 `tools/native_mobility.py::correct` 在导入和政策刷新时调用。原始基值保存在 `sourceStats.enBeforeReduction`，倍率保存在 `sourceStats.enCapacityMultiplier`；重复刷新按原始基值计算，不能再次对已减半值乘0.5。
- 用户指定例外：扎古II C型 `MS_06C` 的最终 EN 固定为350，保证350 EN核弹可用。例外记录在 `tools/unit_energy.py::EN_CAPACITY_OVERRIDES` 与 `sourceStats.enCapacityOverride`，优先于通用50%规则。
- 武器 EN 消耗不随单位容量减半，继续按原生发射链计算。原生审计将单位 EN 上限与消耗分别核对。若武器消耗超过调整后的容量，应报告并遵循用户指定的容量例外，不擅自改写武器消耗。

## 移动力：基础格数、加成和地图可达性

- 新导入普通单位的基础格数见 `tools/import-additional-units.py`：`max(3, min(9, round(5 × 原生 boostMoveSpeed ÷ 1.4)))`。原版常规 BoostSpeed 对应 `boostMoveSpeed`，导入后存为 `sourceStats.boostSpeed`；它是评估移动力的基准，不以 `baseMoveSpeed`、反应值或动画速度替代。`onDodgeBoostSpeed` 是闪避加速，`extraBoostSpeed` 属于条件加速，不应混入常态基础值；形态或技能加速应另行评估。Python `round` 的中点行为及 3–9 夹限属于现行公式。
- `tools/weapon_policy.py` 将基础值保存为 `sourceStats.tacticalMoveBeforeBonus`，最终 `stats.move = 基础值 + 1`，战舰则 `+3`。该基值使重复刷新不重复叠加。旧单位和特殊形态可能有显式平衡基值，不能只按推进速度公式重算。例如当前 61 式基础 4、最终 5，RX-78-2 基础 6、最终 7，萨拉米斯级基础 4、最终 7。
- `stats.move` 不是每张地图上必定能走的格数。`shared/rules.js` 还按环境适应性、地形消耗、敌方控制区、占地和增益/惩罚计算可达路径。异常时先区分基础值错误与路径成本差异，不为补偿地形代价而任意改原生推进速度。
- 新增或改修单位需并列记录原生 `boostMoveSpeed`、基础计算值、同平台参照、战术加成与最终 `stats.move`。有意偏离时写明战术理由及生成政策；仅有公式不等于平衡正确。

## 换算合理性审查

- 武器政策以类别固定射程，会抹平同类别原生远近差异。迁移新武器时记录原生 `limitingRange`、换算基础值、同类别项目值及同平台武器对照；核对最小射程、反击资格和地图尺度。若差异会改变武器定位，提出有据可查的单武器政策例外，而非直接修改最终 JSON。
- AP 政策多数按类别给 2–3 AP，原生连射发数和实际扣能未自动进入 AP 公式。评估一回合可攻击次数时同时比较整段发射流程的伤害、EN、射程、命中和其他同预算单位，特别留意高发数武器与 1 AP 特例；不要仅因名称相同就采用相同 AP。
- 基础移动公式在 3 与 9 格处截断，可能让速度差较大的单位得到相同移动力；另有旧单位显式基值和战舰 +3 加成。评估时对同平台慢/中/快单位比较原生速度排序与最终格数排序，再看地图尺寸、占地、地形成本和适应性。若公式失真，先明确是导入公式、战术加成还是单单位例外，再调整相应政策；不得把视野当作移动距离的附带结果。

## 视野：保留既有独立换算

- `tools/native_sensors.py` 先读继承后的 `hiddenAction_Start_SetStats`，再用 `hiddenAction_InitializeStats` 覆盖同名内存值；不能抓文本里的第一个宏。原值保存于 `sourceStats.sensors`。缺省原生雾视距 20、雷达探测距离 360、反侦测距离 0；表达式需解析后再换算。
- `stats.sensors.sight = round(原生 baseFogOfWarSightRange × 0.4)`（四舍五入为整数）；`radar = 原生 baseDetectRange ÷ 36`；`antiDetection = 原生 baseAntiDetectRange ÷ 28.8`。普通原生雷达若是雾视距的 18 倍，转换后为取整前项目视距的 1.25 倍。侦察单位、舰船及负反侦测值保留原生比例，不能统一改为 `sight × 1.25`。例如原生视距 18、雷达 324 → 视距 7、雷达 9；头部损坏后的实际视野也取整。
- `shared/unit-sensors.js` 在战斗中另外处理头部损坏、米诺夫斯基效果、隐蔽/反侦测、跨空地层和舰船 `revealOnDetection`。雷达接触、已探测和实际可见不同；普通直接攻击要求目标可见。不要通过改武器射程或移动力修补视野问题。

核对时记录每项原生值、导入基础值、最终值及覆盖原因；先查用户指定特例。批量刷新可能改写全部单位，需限定范围并审阅差异。

- RFF_06 扎尼的发布 COST 固定为 75；`tools/v05_balance.py` 同步保留此例外。

## 生产与科技资源

- `tools/import-production.py` 只读原工厂 `action_Produce_*` 与实际排队／触发链，不能用 `AutoProduce` 的 AI 价格、单位 COST 或工厂建筑造价代替生产价。`EquipmentIndex` 对应当前武器组，输出写入 `shared/production-catalog.json`；批次数量由实际 `produceUnits` 相加，常见3台或1台，原版运输车2台批次保留。原MOD混合武器小队在当前生产系统中统一为所选生产套件；`output` 保存统一后的产出，`source.outputs` 继续完整备份原始混编。
- 素体选同一单位资金、物资都最低的方案；当前来源不存在两种价格互相冲突的情况。若未来出现冲突，导入器应报错供人工确认，不能悄悄变更折算权重。
- 套件独立库存，购买数量等于素体批次台数。每套的两种资源价格分别为 `max(0, ceil(套件原厂批价/套件产量 - 素体原厂批价/素体产量))`，再乘本批套件数计费。素体自带的套件无需另购；未找到原厂价格的套件仍可预览，不能凭空定价或免费获得。
- 科技节点的资金、物资为原 MOD `TechList_*` 对应 Awake 动作的2倍，科技点继续使用节点自身配置。`sourceCosts` 备份原价、原科技点及研发秒数；生产 `source` 备份工厂路径、动作、生产秒数、队列延迟与实际产出。本阶段不运行时间等待。

- 套件命名由 `tools/native_weapon_layout.py:kit_names` 维护：只有一个武器组的单位统一叫“标准套件”；苍白骑兵及其 HADES 形态的 `kit_0` 叫“复合发射器套件”。保留套件 ID 和存档别名。
