---
name: projectgreed-mod-unit-import
description: 移植、修复或核对ProjectGreed的原MOD单位、武器、左右演出和衍生形态；原MOD仅作读取来源。
---

# ProjectGreed 原MOD单位移植

在仓库根目录工作，先读AGENTS.md。用户当前要求优先；本文不保存逐版本规则历史，避免旧断言覆盖现行需求。

## 工作流

1. 明确单位ID与范围。用tools/mod_source.py读取INI/GW及copyFrom继承；沿真实动作、alsoTriggerAction、炮口和附件追踪。不要修改原MOD，不按文件名推断最终流程。
2. 对照[入口与刷新边界](../../../docs/imports/skill-pipeline.md)、[数值核对](../../../docs/imports/skill-conversion.md)及[易误判机制](../../../docs/imports/skill-mechanics.md)。批量导入会覆盖单位；单单位任务限定构造器或目标ID。
3. 保留source/sourceStats/nativeTiming/nativePayload。使用共用武器模板，枪口、贴图及单位特例放在覆盖配置。人工数值编辑在shared/editor-adjustments.json保存相对基准差值，不能烘焙回源数据。
4. 套件默认沿用原MOD0号套件；普通对局采用永久部署许可，战略对局内生产独立部队和装备。驾驶员门槛转为pilotRequirements，不明机制记录为review，不用占位按钮声称完成。
5. 左右武器按物理枪口与真实发射链拆分，不能复制整套载荷。B段格斗动画和特效沿源动作追踪；发射时按目标瞄准。舰船炮塔保留独立HP、射界和默认角度。
6. 按原值、导入基础、全局换算、人工差值、最终取整顺序核对。改负责生成的政策，不只改生成结果。原生时间与演出速度不代替格子射程。

## 当前执行合同

- 武器类型为单层WeaponClasses；现行伤害、命中、射程、轮数和技能只查询[自动生成规则](../../../docs/rules/combat.md)及shared/conversion-rules.json，不在此重复数值表。
- AP只保留stats.actionPoints和actionCost参考值。没有AP倍率、预算、扣费、返还、恢复、机动AP加成或减AP状态。AP专用EMP不提供施放入口。穿甲beamAP/shellAP等独立伤害分量保持有效。
- 属性、AP参考、命中、EN和移动值为整数；伤害按25取整。倍率、概率和演出时间/坐标保留精度。旧ACE小数成长按精确曲线兼容，不丢等级、经验与战绩。
- 自动进攻/反击使用合法武器、按类型轮数和EN执行，射击结束后轮流格斗。六机小队目标为整队；格斗反击由被近身者逐个回击。伤亡停止未发起的后续攻击。
- 普通格斗与冲撞分开：复数非冲撞格斗保留一把基础无门槛格斗，仅额外无原门槛招式补格斗125；原MOD门槛保留。冲撞是无其他可用格斗时的兜底。
- 攻击类技能（照射、迫击炮、蓄力狙击）与普通攻击互斥；EN、冷却、次数、consumeAction保持独立。变形/解除变形/部署/解除部署共享当回合使用标记。
- EN容量保持原MOD的100%，不再应用统一减半；武器EN沿原发射链。移动、视野、雷达分别核对，不把机动解释为回避。驾驶员反应影响回避，机动仅影响移动。
- 原生衰减贯穿弹丸转换为基础对应伤害×贯穿次数×15%的穿甲附伤，不做物理多目标贯穿。穿甲默认只计算50%对应百分比抗性，固定防护和盾牌照常。
- 父格纳库死亡强制脱出仅本回合攻击轮数向下折半、允许0；主动出击无此惩罚。SFS和格纳库共用权威状态、确认/取消及日志，不提前揭示视野。

## 验证与文档

- 运行本次改动相关的Node/WebSocket和浏览器检查，再npm run build；不要重复运行旧166项基线失败的全量套件。
- AP/数值改动验证tests/ap-reference-only.test.cjs、integer-gameplay-values、weapon-accuracy-unification、damage-rounding、automatic-fire-network；穿甲验证armor-piercing。相关视觉与音效须另行核对，静态通过不代表画面正确。
- 单位能编组、部署、移动、攻击、应战、结算、死亡，AI遵守适应性和权限。联机沿用动作ID/revision去重、并行应战及全员演出完成屏障。
- 说明文档和生成报告全部写docs/；本SKILL因工具发现约定保留原位。移植缺口列具体来源与转换建议；旧文件名带版本号不构成删除有效导入脚本的理由。
- 默认只构建客户端；仅用户明确要求时构建开发者版、打包服务端、提交或推送。


## 武器命名与套件COST

- 名称依据sourceName与真实弹种识别，不把所有含Rifle的名称视为光束步枪。EF_GMRifle为90mm机枪，BeamRifle/BR及SBR/HBR/LBR为光束步枪家族；同步name和中英日localization及主武器套件名。管理员专有复合套件名保留。
- 光束步枪和加农炮的默认套件COST加成为75，读取assets/weapon-kit-costs.json；tools/weapon_kit_policy.py统一导入生成，不在多个导入器硬编码100。原生资金/物资价格备份不改。
- 定向刷新用tools/repair-weapon-names-and-kit-costs.py，不重导素材或载荷；验证tests/weapon-names-kit-costs.test.cjs及同名浏览器检查。
