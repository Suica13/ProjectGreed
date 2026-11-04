# 移植数值核对

本页为移植方法，现行数值统一查询[武器与技能](../rules/combat.md)、[驾驶员](../rules/pilots.md)以及shared/conversion-rules.json，避免重复维护规则表。

1. 原MOD只读。用tools/mod_source.py追踪INI/GW继承和实际动作链，保留source/sourceStats/nativePayload/nativeTiming。武器发数和EN沿真实扣费和发射链读取。
2. 原始单位JSON引用共用武器模板；只在单位覆盖中记录枪口、炮塔、贴图和特例。人工数值差值不烘焙回原始数据。
3. 类型规则和全局换算先执行，人工差值随后执行，再取整及校验。属性和命中等四舍五入为整数；伤害按25取整。倍率、概率、时间和坐标保留精度。
4. AP只保留源配置参考值。不要重新引入机动AP加成、类型/全局AP倍率、AP预算、扣费、恢复或EMP减AP状态。beamAP等为穿甲伤害类型，不能按行动点处理。
5. EN容量保持原MOD的100%，不再应用统一减半；武器EN不随容量折半。移动从常规推进速度与当前战术政策核对，反应独立影响回避。视野按原MOD×0.4、雷达÷36、反侦测÷28.8独立换算。
6. 同类武器固定基础命中由weaponClasses.baseHit维护；舰炮额外命中倍率0.85。原载荷穿甲分量与贯穿附伤不得合并成普通伤害，默认忽略50%百分比抗性。

验证integer-gameplay-values、ap-reference-only、weapon-accuracy-unification、damage-rounding及相关Node/WebSocket回归，再构建客户端。视觉、音效和左右炮口需另行验证。
